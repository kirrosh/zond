---
id: ARV-331
title: >-
  checks run / request: no runtime TLS-CA or --insecure for self-signed corp
  hosts
status: To Do
assignee: []
created_date: '2026-07-03 13:19'
labels:
  - bug
  - tls
  - live
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Only `zond add api` accepts `--insecure`. Runtime commands (`zond request`, `checks run`, `probe`, `run`) have no way to trust a self-signed corp CA or skip TLS verification. On an internal host with a corp CA in the chain, every live request fails `self signed certificate in certificate chain`.

Repro: `zond request GET /... --api <corp-api>` against an alfaintra.net-style host with a private CA → TLS error. Only workaround found: export corp CA from system keychain and set `NODE_EXTRA_CA_CERTS` before every command.

Discovered during live zond-scan of docgen-core v30 (report-zond MF2).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Add tls_ca_file / insecure option in .env.yaml OR a runtime flag on request/checks run/probe/run
- [ ] #2 Corp self-signed host works without NODE_EXTRA_CA_CERTS env workaround
- [ ] #3 Insecure path is opt-in and logged (never silent)
<!-- AC:END -->
