# Pydroid 3 configuration encryption

The utility `tools/pydroid_config_crypto.py` encrypts a local `.env`-style file with AES-256-GCM. It derives the encryption key from a passphrase using PBKDF2-HMAC-SHA-256. The passphrase is never written into `config.enc`.

## Install in Pydroid 3

Open Pydroid 3, open its **Pip** terminal, and run:

```bash
pip install cryptography
```

Copy `pydroid_config_crypto.py` to a directory accessible from Pydroid, such as `Download/nebula-nook/`. Use Pydroid’s terminal and change into that directory.

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

Koyeb cannot start the application from `config.enc` unless the application is explicitly changed to decrypt it at startup. The passphrase would still need to be stored as one protected Koyeb secret, for example `CONFIG_DECRYPTION_PASSWORD`. Therefore encryption protects the public GitHub repository, but it does not eliminate the need for one private runtime secret.

The encrypted file alone is not enough for Koyeb to recover the configuration. If the goal is the most reliable deployment, enter the individual values into Koyeb’s encrypted environment settings. If the goal is one public GitHub file, the application must be extended with startup decryption and the passphrase must remain outside GitHub.
