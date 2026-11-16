#!/bin/sh
# Writes a version into the client's source before a build:
#
#   stamp-version.sh v0.0.7 [client/src/version.ts]
#
# The file says VERSION is 'dev' in the repository. This puts the version in its place, and fails
# if the version is not of the shape vMAJOR.MINOR.PATCH or the file does not hold the line to change.
set -eu
version="${1:-}"
file="${2:-client/src/version.ts}"
if ! printf '%s\n' "$version" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "not a version: '$version'" >&2
  exit 2
fi
if ! grep -q "VERSION: string = 'dev'" "$file"; then
  echo "$file does not hold the line VERSION: string = 'dev'" >&2
  exit 1
fi
sed "s/VERSION: string = 'dev'/VERSION: string = '$version'/" "$file" > "$file.stamped"
mv "$file.stamped" "$file"
grep -q "VERSION: string = '$version'" "$file"
echo "$file: $version"
