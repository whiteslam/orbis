"""python -m research_desk run --run-ids <id,id>  |  python -m research_desk settle --user-id <id>

Started by the private repo's workflow. Reads SUPABASE_URL,
SUPABASE_SERVICE_ROLE_KEY and OPENROUTER_API_KEY (and optionally
NEWSDATA_API_KEY) from the environment. Input is checked before anything
touches the network. Exit code 0 when every run ended (done, cancelled or
failed is still an ending); 1 when the worker itself couldn't work; 2 for bad input.
"""

from __future__ import annotations

import argparse
import os
import sys

from research_desk import safe_log
from research_desk.safe_log import UUID

MAX_RUNS = 20


def _ids(text: str) -> list[str] | None:
    ids = [part.strip() for part in (text or "").split(",") if part.strip()]
    if not ids or len(ids) > MAX_RUNS or not all(UUID.match(part) for part in ids):
        return None
    return list(dict.fromkeys(ids))


def connect():
    """The database and the run dependencies, from the environment."""
    from research_desk.news import register
    from research_desk.run import Deps, UpstreamGraph, configure_logging, resolve_company_name, upstream_today
    from research_desk.supabase import SupabaseRest
    from tradingagents.default_config import build_default_config

    configure_logging()
    if not os.environ.get("OPENROUTER_API_KEY", "").strip():
        raise RuntimeError("OPENROUTER_API_KEY is not set")
    db = SupabaseRest(os.environ.get("SUPABASE_URL", ""), os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""))
    register()
    return Deps(db=db, make_graph=UpstreamGraph, base_config=build_default_config(), today=upstream_today,
                resolve_name=resolve_company_name)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="research_desk")
    sub = parser.add_subparsers(dest="mode")
    run = sub.add_parser("run")
    run.add_argument("--run-ids", default="")
    settle = sub.add_parser("settle")
    settle.add_argument("--user-id", default="")
    try:
        args = parser.parse_args(argv)
    except SystemExit:
        return 2

    if args.mode == "run":
        ids = _ids(args.run_ids)
        if ids is None:
            print("run needs --run-ids: one to twenty research run ids", file=sys.stderr)
            return 2
    elif args.mode == "settle":
        if not UUID.match(args.user_id or ""):
            print("settle needs --user-id", file=sys.stderr)
            return 2
    else:
        parser.print_usage(sys.stderr)
        return 2

    try:
        deps = connect()
    except Exception as error:  # noqa: BLE001
        print(f"The worker couldn't start: {type(error).__name__}", file=sys.stderr)
        return 1

    from research_desk.run import run_one, settle_user

    if args.mode == "settle":
        try:
            settle_user(args.user_id, deps)
            return 0
        except Exception as error:  # noqa: BLE001
            safe_log.failure(args.user_id, error)
            return 1

    broken = False
    for run_id in ids:
        safe_log.stage(run_id, "start")
        try:
            run_one(run_id, deps)
        except Exception as error:  # noqa: BLE001 — one run's trouble never stops the next
            safe_log.failure(run_id, error)
            broken = True
    return 1 if broken else 0


if __name__ == "__main__":
    sys.exit(main())
