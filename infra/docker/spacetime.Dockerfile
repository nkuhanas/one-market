FROM clockworklabs/spacetime:v2.10.1

USER root
RUN rustup toolchain install 1.93.0 --profile minimal \
      --component rustfmt --component clippy --target wasm32-unknown-unknown \
    && mkdir -p /data /state /cache/cargo /workspace/target \
    && chmod 1777 /data /state /cache/cargo /workspace/target
WORKDIR /workspace
