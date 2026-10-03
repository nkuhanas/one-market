FROM clockworklabs/spacetime:v2.10.1@sha256:5231fa24bc8eaa28b2a3c6a4725f1d31e6a868e2e9b311c8efa1ddc314466014

USER root
RUN rustup toolchain install 1.93.0 --profile minimal \
      --component rustfmt --component clippy --target wasm32-unknown-unknown \
    && mkdir -p /data /state /cache/cargo /workspace/target \
    && chmod 1777 /data /state /cache/cargo /workspace/target
WORKDIR /workspace
