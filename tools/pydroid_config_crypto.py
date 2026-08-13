#!/usr/bin/env python3
"""Encrypt and decrypt a local .env-style configuration on Android/Pydroid 3.

Install once in Pydroid's Pip terminal:
    pip install cryptography

Examples:
    python pydroid_config_crypto.py template
    python pydroid_config_crypto.py encrypt config.env config.enc
    python pydroid_config_crypto.py decrypt config.enc config.decrypted.env
    python pydroid_config_crypto.py verify config.enc

The password is never stored in the encrypted file. Keep it outside GitHub.
"""

from __future__ import annotations

import argparse
import base64
import getpass
import hashlib
import hmac
import secrets
import sys
from pathlib import Path

# This implementation intentionally uses only Python's standard library so it
# works in Pydroid 3 without Rust, a compiler, or native cryptography wheels.
# It uses PBKDF2-HMAC-SHA256 for key derivation, HMAC-SHA256 authentication,
# and a SHA256/HMAC-derived keystream for confidentiality.
MAGIC = b"NEBULA-NOOK-CONFIG-v2\n"
SALT_BYTES = 16
NONCE_BYTES = 32
KEY_BYTES = 64
TAG_BYTES = 32
PBKDF2_ROUNDS = 390_000

TEMPLATE = """# Nebula Nook configuration template\n# Replace every placeholder locally. Never commit this plaintext file.\n\nDATABASE_URL=\nJWT_SECRET=\nTELEGRAM_BOT_TOKEN=\nTELEGRAM_WEBHOOK_SECRET=\nTELEGRAM_ADMIN_CHAT_ID=\nBINANCE_PAY_API_KEY=\nBINANCE_PAY_SECRET_KEY=\nOWNER_OPEN_ID=\nOWNER_NAME=\nVITE_APP_ID=\nVITE_APP_TITLE=Nebula Nook Bot\nVITE_APP_LOGO=\nOAUTH_SERVER_URL=\nVITE_OAUTH_PORTAL_URL=\nBUILT_IN_FORGE_API_URL=\nBUILT_IN_FORGE_API_KEY=\nVITE_FRONTEND_FORGE_API_URL=\nVITE_FRONTEND_FORGE_API_KEY=\nVITE_ANALYTICS_ENDPOINT=\nVITE_ANALYTICS_WEBSITE_ID=\nNODE_ENV=production\n"""


def derive_key(password: str, salt: bytes) -> tuple[bytes, bytes]:
    material = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS, dklen=KEY_BYTES
    )
    return material[:32], material[32:]


def xor_keystream(data: bytes, key: bytes, nonce: bytes) -> bytes:
    output = bytearray(len(data))
    for offset in range(0, len(data), 32):
        counter = offset // 32
        block = hmac.new(
            key, nonce + counter.to_bytes(8, "big"), hashlib.sha256
        ).digest()
        chunk = data[offset : offset + len(block)]
        for index, value in enumerate(chunk):
            output[offset + index] = value ^ block[index]
    return bytes(output)


def ask_password(confirm: bool = False) -> str:
    password = getpass.getpass("Encryption password: ")
    if len(password) < 16:
        raise ValueError("Use a password/passphrase of at least 16 characters.")
    if confirm:
        second = getpass.getpass("Repeat password: ")
        if password != second:
            raise ValueError("Passwords do not match.")
    return password


def encrypt_file(source: Path, destination: Path) -> None:
    if not source.is_file():
        raise FileNotFoundError(f"Plaintext config not found: {source}")
    if destination.exists():
        answer = input(f"Overwrite {destination}? Type YES: ")
        if answer != "YES":
            raise RuntimeError("Cancelled.")

    plaintext = source.read_bytes()
    salt = secrets.token_bytes(SALT_BYTES)
    nonce = secrets.token_bytes(NONCE_BYTES)
    enc_key, mac_key = derive_key(ask_password(confirm=True), salt)
    ciphertext = xor_keystream(plaintext, enc_key, nonce)
    tag = hmac.new(mac_key, MAGIC + salt + nonce + ciphertext, hashlib.sha256).digest()
    payload = MAGIC + base64.b64encode(salt + nonce + tag + ciphertext) + b"\n"
    destination.write_bytes(payload)
    try:
        destination.chmod(0o600)
    except OSError:
        pass
    print(f"Encrypted configuration written to: {destination}")
    print("Only commit the encrypted file. Keep the password private.")


def decrypt_bytes(source: Path, password: str) -> bytes:
    raw = source.read_bytes()
    if not raw.startswith(MAGIC):
        raise ValueError("Not a Nebula Nook encrypted config or unsupported version.")
    encoded = b"".join(raw[len(MAGIC) :].split())
    packed = base64.b64decode(encoded, validate=True)
    if len(packed) <= SALT_BYTES + NONCE_BYTES + TAG_BYTES:
        raise ValueError("Encrypted file is incomplete.")
    salt = packed[:SALT_BYTES]
    nonce = packed[SALT_BYTES : SALT_BYTES + NONCE_BYTES]
    tag_start = SALT_BYTES + NONCE_BYTES
    tag = packed[tag_start : tag_start + TAG_BYTES]
    ciphertext = packed[tag_start + TAG_BYTES :]
    enc_key, mac_key = derive_key(password, salt)
    expected = hmac.new(
        mac_key, MAGIC + salt + nonce + ciphertext, hashlib.sha256
    ).digest()
    if not hmac.compare_digest(tag, expected):
        raise ValueError("Decryption failed: wrong password or modified file.")
    return xor_keystream(ciphertext, enc_key, nonce)


def decrypt_file(source: Path, destination: Path) -> None:
    if not source.is_file():
        raise FileNotFoundError(f"Encrypted config not found: {source}")
    if destination.exists():
        answer = input(f"Overwrite {destination}? Type YES: ")
        if answer != "YES":
            raise RuntimeError("Cancelled.")
    destination.write_bytes(decrypt_bytes(source, ask_password()))
    try:
        destination.chmod(0o600)
    except OSError:
        pass
    print(f"Decrypted configuration written to: {destination}")
    print("Delete this plaintext output after use and never upload it to GitHub.")


def verify_file(source: Path) -> None:
    if not source.is_file():
        raise FileNotFoundError(f"Encrypted config not found: {source}")
    plaintext = decrypt_bytes(source, ask_password())
    text = plaintext.decode("utf-8")
    names = {
        line.split("=", 1)[0].strip()
        for line in text.splitlines()
        if line.strip() and not line.lstrip().startswith("#") and "=" in line
    }
    required = {
        "DATABASE_URL",
        "TELEGRAM_BOT_TOKEN",
        "TELEGRAM_WEBHOOK_SECRET",
        "BINANCE_PAY_API_KEY",
        "BINANCE_PAY_SECRET_KEY",
    }
    missing = sorted(required - names)
    if missing:
        raise ValueError("Missing required variable names: " + ", ".join(missing))
    print(f"Verified: {source} decrypts successfully and contains the required variable names.")
    print("Values were not printed.")


def interactive_menu() -> int:
    print("\\nNebula Nook configuration utility")
    print("1. Create a configuration template")
    print("2. Encrypt a configuration file")
    print("3. Decrypt an encrypted configuration")
    print("4. Verify an encrypted configuration")
    print("0. Exit")
    choice = input("Choose an option: ").strip()
    if choice == "0":
        return 0
    if choice == "1":
        output = Path(input("Template filename [config.txt]: ").strip() or "config.txt")
        if output.exists() and input(f"Overwrite {output}? Type YES: ") != "YES":
            raise RuntimeError("Cancelled.")
        output.write_text(TEMPLATE, encoding="utf-8")
        print(f"Template written to: {output}")
        print("Fill it locally, then choose option 2. Do not upload the plaintext file.")
        return 0
    if choice == "2":
        source = Path(input("Plaintext filename [config.txt]: ").strip() or "config.txt")
        destination = Path(input("Encrypted filename [config.enc]: ").strip() or "config.enc")
        encrypt_file(source, destination)
        return 0
    if choice == "3":
        source = Path(input("Encrypted filename [config.enc]: ").strip() or "config.enc")
        destination = Path(input("Output filename [decrypted.txt]: ").strip() or "decrypted.txt")
        decrypt_file(source, destination)
        return 0
    if choice == "4":
        source = Path(input("Encrypted filename [config.enc]: ").strip() or "config.enc")
        verify_file(source)
        return 0
    raise ValueError("Please choose 0, 1, 2, 3, or 4.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Nebula Nook local config encryption utility")
    sub = parser.add_subparsers(dest="command")

    template = sub.add_parser("template", help="write a safe plaintext template")
    template.add_argument("output", nargs="?", default="config.txt")

    encrypt = sub.add_parser("encrypt", help="encrypt a plaintext config")
    encrypt.add_argument("source")
    encrypt.add_argument("destination", nargs="?", default="config.enc")

    decrypt = sub.add_parser("decrypt", help="decrypt a config for local inspection")
    decrypt.add_argument("source", nargs="?", default="config.enc")
    decrypt.add_argument("destination", nargs="?", default="decrypted.txt")

    verify = sub.add_parser("verify", help="verify decryption without writing plaintext")
    verify.add_argument("source", nargs="?", default="config.enc")

    args = parser.parse_args()
    try:
        if args.command is None:
            return interactive_menu()
        if args.command == "template":
            output = Path(args.output)
            if output.exists() and input(f"Overwrite {output}? Type YES: ") != "YES":
                raise RuntimeError("Cancelled.")
            output.write_text(TEMPLATE, encoding="utf-8")
            print(f"Template written to: {output}")
            print("Fill it locally, then encrypt it. Do not commit the plaintext file.")
        elif args.command == "encrypt":
            encrypt_file(Path(args.source), Path(args.destination))
        elif args.command == "decrypt":
            decrypt_file(Path(args.source), Path(args.destination))
        elif args.command == "verify":
            verify_file(Path(args.source))
        return 0
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
