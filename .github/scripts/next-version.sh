#!/bin/sh
# Prints the next version tag.
#
#   git tag --list | next-version.sh              the next version
#   git tag --points-at HEAD | next-version.sh --highest
#                                                 the highest version among them as it is, or nothing
#
# Reads tags from standard input, one a line. Takes the highest "vMAJOR.MINOR.PATCH" among them and
# adds one to its patch number. With no such tag it prints v0.0.1. Lines of any other shape
# (v1.2, v1.2.3-rc1, nightly) are ignored.
#
# To start a new minor or major version, tag a commit by hand (v0.1.0, v1.0.0): it is then the
# highest, and the numbers go on from it (v0.1.1, v0.1.2, ...).
awk -F. -v mode="${1:-}" '
  /^v[0-9]+\.[0-9]+\.[0-9]+$/ {
    major = substr($1, 2) + 0; minor = $2 + 0; patch = $3 + 0
    if (!seen || major > M || (major == M && (minor > m || (minor == m && patch > p)))) {
      M = major; m = minor; p = patch; seen = 1
    }
  }
  END {
    if (mode == "--highest") { if (seen) printf "v%d.%d.%d\n", M, m, p }
    else if (seen) printf "v%d.%d.%d\n", M, m, p + 1
    else print "v0.0.1"
  }
'
