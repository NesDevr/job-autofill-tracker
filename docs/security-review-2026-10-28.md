# Development dependency security review

Review date: 2026-10-28. Release prepared: 0.1.1.

The initial npm audit reported 15 affected development packages: 3 critical,
11 high, and 1 moderate. The production dependency audit reported zero.
This work updates the affected dependencies without a WXT major/minor upgrade
or changes to the extension's production dependencies or permissions.

## Remediation

| Originally reported package | Severity | Resolution |
| --- | --- | --- |
| adm-zip | High | Override 0.6.1; fixes unsafe archive extraction and decompression. |
| baseline-browser-mapping | Moderate | Override 2.11.0. |
| brace-expansion | High | Override 1.1.21. |
| browserslist | High | Override 4.28.7 and its required browser compatibility data. |
| firefox-profile | High | Its vulnerable adm-zip dependency is overridden to 0.6.1. |
| fx-runner | Critical | Its vulnerable shell-quote dependency is overridden to 1.11.0. |
| nanoid | High | Override 3.3.18. |
| node-forge | High | Override 1.4.1; see the narrow release-age exception below. |
| postcss | High | Override 8.5.23. |
| shell-quote | Critical | Replace the existing 1.9.0 override with 1.11.0. |
| source-map-js | High | Override 1.2.2. |
| vite | High | Direct dependency 7.3.7; nested vite-node dependency 8.1.6. |
| web-ext-run | Critical | Fix the inherited firefox-profile and fx-runner findings above. |
| wxt | High | Fix its inherited web-ext-run findings; retain WXT 0.20.27. |
| zod | High | Override 4.6.6. |

The nested Vite patch also requires newer Rolldown bindings/types and Picomatch.
Those changes and the Browserslist data changes are required by patched parent
packages. Other direct package versions remain unchanged.

## Dependency source and execution review

Exact package names, versions, official repository URLs, maintainers, registry
tarball URLs, release dates, and declared scripts were inspected using npm's
official HTTPS registry. Some registry records omit the individual publisher;
maintainer metadata is not treated as proof of the publisher's identity.
The npm lockfile retains integrity hashes. No Git, local tarball, or alternative
registry dependency was introduced. No forced audit fix was used.

Install scripts remain enabled. The existing esbuild binary installer and
spawn-sync postinstall were reviewed before the clean install. The updated
packages do not add install hooks. The root postinstall remains `wxt prepare`.

## Release-age policy and exception

`.npmrc` sets `min-release-age=3` (72 hours). The project requires npm 11.19.0
or newer with `engine-strict=true` so unsupported npm clients do not silently
ignore the policy. This filter governs dependency resolution; the lockfile and
integrity hashes govern reproducible `npm ci` installs.

One agent-approved security exception applies to **node-forge 1.4.1 only**:

- Published: 2026-10-27 at 04:44:07 UTC; reaches 72 hours on 2026-10-30 at
  04:44:07 UTC.
- Reason: immediately remediate the high-severity RSA PKCS#1 v1.5 signature
  verification issue reported as
  [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
  The advisory affects versions through 1.4.0; 1.4.1 is the selected fix.
- Scope: an exact package override and the command-line option
  `--min-release-age-exclude=node-forge` for this resolution/install. The package
  is a transitive development dependency of the Android debugging helper.
- No exclusion is persisted in `.npmrc`; the delay remains in effect for every
  other package. No other release-age exception was used.

## Release version

No GitHub releases or remote Git tags were found during the review. Chrome Web
Store publication status was not available. Both package and extension manifest
versions are advanced from 0.1.0 to 0.1.1 so the new build can replace an installed
0.1.0 without reusing its version number. No store publication is performed by
this change.

## Validation

- Clean lockfile install with scripts enabled: `npm ci --min-release-age-exclude=node-forge`.
- `npm audit` and `npm audit --omit=dev`: zero reported vulnerabilities.
- `npm audit signatures`: all 423 installed packages have verified registry
  signatures; 87 also have verified provenance attestations.
- `npm run compile`: passed.
- `npm run test:backup`: all 8 tests passed.
- `node scripts/test-linkedin-probes.mjs`: all 5 tests passed.
- `npm run zip`: production build and Chrome ZIP generation passed.
- Synthetic compatibility checks: AdmZip archive round-trip, shell-quote
  round-trip, and node-forge RSA signature verification/rejection passed.
- Package, root lockfile, lockfile package record, and generated manifest
  versions agree on 0.1.1; `npm ls --all` reports no dependency tree problems.
- The generated extension ZIP contains no local profile, resume-import, or agent
  instruction paths, and no matches for the personal-data/credential patterns
  checked in the release review.

No live Chrome or Firefox UI smoke test or Chrome Web Store upload was performed.
