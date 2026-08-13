# Pydroid 3 configuration encryption

The utility `tools/pydroid_config_crypto.py` encrypts a local `.env`-style file using only Python’s standard library. It derives separate encryption and authentication keys from a passphrase with PBKDF2-HMAC-SHA-256, uses a HMAC-derived keystream for confidentiality, and authenticates the encrypted payload with HMAC-SHA-256. The passphrase is never written into `config.enc`.

## Install in Pydroid 3

There are **no third-party packages to install**. Copy `pydroid_config_crypto.py` to a directory accessible from Pydroid, such as `Download/nebula-nook/`, and run it from Pydroid’s terminal. This avoids the Rust/compiler issue encountered while installing `cryptography` on Android Python 3.11.

This dependency-free implementation is convenient for the Android workflow, but a standard, audited library such as AES-GCM remains preferable when a compatible native package is available. Do not reuse this custom format for high-value secrets beyond the intended deployment handoff, and keep the password separate from the encrypted file.

## Create and fill the template

```bash
python pydroid_config_crypto.py template config.env
```

Open `config.env` in Pydroid’s editor and replace the blank values with the real values. Do not send this plaintext file through chat and do not upload it to GitHub.

## Encrypt it

```bash
python pydroid_config_crypto.py encrypt config.env config.enc
```

Use a strong passphrase of at least 16 characters. The command writes only the encrypted payload to `config.enc`; it does not print the credentials.

The public repository may contain `config.enc`, but it must not contain `config.env`, `config.decrypted.env`, the passphrase, or any backup of the plaintext file. Add these lines to `.gitignore` locally:

```gitignore
config.env
config.decrypted.env
*.env
*.env.*
```

## Verify without printing values

```bash
python pydroid_config_crypto.py verify config.enc
```

This checks that the passphrase works and that required variable names are present without displaying their values.

## Decrypt only when necessary

```bash
python pydroid_config_crypto.py decrypt config.enc config.decrypted.env
```

Delete `config.decrypted.env` immediately after use. Never commit it.

## Koyeb limitation

Koyeb starts the application from `config.enc` after the bot decrypts it at startup. Store the same encryption password as one protected Koyeb secret named `PASS`. Therefore encryption protects the public GitHub repository, while `PASS` remains the only private runtime value required for the encrypted configuration.

The bot now loads `cfg.enc` during startup and applies its non-empty settings before Telegram and database modules initialize. The encrypted file may be public, but the `PASS` value must remain private in Koyeb. Do not add the plaintext configuration or the password to GitHub.
