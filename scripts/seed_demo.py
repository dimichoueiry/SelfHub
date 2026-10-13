"""Seed the Northline demo company into a config dir (a new temp dir by default).

    uv run python scripts/seed_demo.py [config dir]

Then: SELFHUB_DEMO=1 SELFHUB_CONFIG_DIR=<dir> uv run selfhub-api
"""

from selfhub_api.demo import main

if __name__ == "__main__":
    main()
