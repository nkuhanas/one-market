#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

cloud_node() {
  compose run --rm --no-deps \
    -e MAINCLOUD_SERVER -e MAINCLOUD_DATABASE -e SPACETIMEDB_TOKEN \
    -e CONFIRM_MAINCLOUD -e MAINCLOUD_PUBLISH_MODE -e POPULATION -e SEED \
    cloud-admin node scripts/maincloud.mjs "$@"
}
