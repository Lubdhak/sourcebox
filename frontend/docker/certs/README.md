# Corporate proxy certificates

Drop a PEM-encoded root CA here as `*.crt` if your network performs TLS inspection
(Zscaler, Netskope, and similar). The Dockerfile bundles anything it finds into
`NODE_EXTRA_CA_CERTS`, which is what npm needs in order to reach the registry.

`./dev` detects your host's CA automatically and copies it here, so you normally do not
need to do anything.

Contents are gitignored: the certificate is specific to one network, and committing it
would break builds for everyone else.

Without it, on an intercepted network, `npm ci` hangs and then fails with an opaque
`UNABLE_TO_GET_ISSUER_CERT_LOCALLY` or `SELF_SIGNED_CERT_IN_CHAIN` error.
