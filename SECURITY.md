# Security

Selmio is pre-release software for a local browser workspace. Browser storage is **not encrypted by Selmio**. Someone with access to the browser profile or a compromised page context may be able to read it. Exported workspace files may contain financial records and should be handled accordingly.

Do not use production financial records to demonstrate a bug. Keep server secrets out of client code, logs, exported workspaces and version control. Optional bank connectivity needs a server-side credential and token design; it does not belong in a static browser bundle.

## Reporting a vulnerability

The source repository is [nimeshbuilds/selmio](https://github.com/nimeshbuilds/selmio). No dedicated security mailbox has been established. Do not post vulnerabilities containing sensitive data in a public issue.

If a distribution enables private vulnerability reporting, use that channel. Otherwise, use an existing private contact for the person who supplied the checkout and ask for a secure reporting route before sharing sensitive details. Include only:

- The affected version or commit and relevant configuration.
- A minimal reproduction using synthetic data.
- The observed impact and any suggested mitigation.

Remove tokens, personal records and account identifiers from attachments. Maintainers have not published a response-time or support commitment.

## Scope of review

Priority areas include script injection through imported data, unintended network disclosure, exposed provider credentials, unsafe file parsing, corrupted exports and changes that silently alter financial calculations. A misleading decision caused by missing or stale data is also worth reporting, with a synthetic example.

Before a public release, establish a private reporting channel, document the supported versions and review storage, backup, dependency and bank-integration risks. Follow the provider's credential-revocation process if a secret has been exposed.
