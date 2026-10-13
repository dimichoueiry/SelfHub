"""HTTP API for the SelfHub dashboard. See docs/dashboard-api-contract.md.

Run it with `uv run selfhub-api` (port 8787). `SELFHUB_DEMO=1` serves a seeded demo
company (Northline) from real local git repos in a temp config dir.
"""

from __future__ import annotations

import hashlib
import os
import tempfile
from dataclasses import dataclass
from html import escape
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel
from selfhub_cli.runtime import resolve_repo_path
from selfhub_cli.settings import config_dir as cli_config_dir
from selfhub_cli.settings import load_settings
from selfhub_cli.workspace import Workspace
from starlette.exceptions import HTTPException as StarletteHTTPException

from selfhub_api.brain import Brain, Context, SpaceLocks
from selfhub_api.errors import ApiError, from_provider_error
from selfhub_api.github import (
    FixtureGitHubProvider,
    GhGitHubProvider,
    GitHubProvider,
    ProviderError,
    parse_github_remote,
)
from selfhub_api.store import Store

DEFAULT_PORT = 8787
DEMO_USER_HEADER = "X-SelfHub-User"
FIXTURE_FILENAME = "github_fixture.json"
DEFAULT_ORIGINS = ("http://localhost:3000", "http://127.0.0.1:3000")

# Demo only: act as another person in the fake org ("view as Maya").
UserHeader = Annotated[str | None, Header(alias=DEMO_USER_HEADER)]


@dataclass(slots=True)
class Settings:
    demo: bool
    config_dir: Path
    personal_path: Path | None = None
    public_url: str = f"http://localhost:{DEFAULT_PORT}"
    cors_origins: tuple[str, ...] = DEFAULT_ORIGINS
    github_org: str | None = None
    demo_user: str | None = None

    @classmethod
    def from_env(cls) -> Settings:
        demo = os.getenv("SELFHUB_DEMO", "").strip().lower() in {"1", "true", "yes"}
        configured = os.getenv("SELFHUB_CONFIG_DIR", "").strip()
        if configured:
            config = Path(configured).expanduser()
        elif demo:
            config = Path(tempfile.mkdtemp(prefix="selfhub-demo-"))
        else:
            config = cli_config_dir()
        personal = os.getenv("SELFHUB_PERSONAL_PATH", "").strip()
        port = os.getenv("SELFHUB_API_PORT", "").strip() or str(DEFAULT_PORT)
        origins = os.getenv("SELFHUB_CORS_ORIGINS", "").strip()
        return cls(
            demo=demo,
            config_dir=config,
            personal_path=Path(personal).expanduser() if personal else None,
            public_url=os.getenv("SELFHUB_API_URL", "").strip() or f"http://localhost:{port}",
            cors_origins=tuple(o.strip() for o in origins.split(",") if o.strip())
            or DEFAULT_ORIGINS,
            github_org=os.getenv("SELFHUB_GITHUB_ORG", "").strip() or None,
            demo_user=os.getenv("SELFHUB_DEMO_USER", "").strip() or None,
        )


class _Body(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")


class SpaceRequest(_Body):
    action: Literal["connect", "create"]
    source: str | None = None
    name: str | None = None
    kind: str | None = None
    description: str | None = None
    owners: list[str] | None = None
    write_policy: str | None = None


class WriteRequest(_Body):
    path: str
    content: str
    message: str = ""
    base_sha: str | None = None


class CreateFileRequest(_Body):
    path: str
    content: str = ""
    message: str = ""


class MoveRequest(_Body):
    from_path: str = Field(alias="from")
    to: str
    message: str = ""


class SaveLocalRequest(_Body):
    message: str = ""


class RejectRequest(_Body):
    reason: str | None = None


class RoleRequest(_Body):
    role: str


class InviteRequest(_Body):
    login: str
    role: str = "read"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    ctx, provider = _bootstrap(settings)

    app = FastAPI(title="SelfHub dashboard API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.ctx = ctx
    app.state.settings = settings

    def brain(user: str | None) -> Brain:
        gh: GitHubProvider = provider
        login = user or settings.demo_user
        if isinstance(provider, FixtureGitHubProvider) and login:
            gh = provider.as_user(login)
        b = Brain(ctx=ctx, gh=gh)
        b.gh.me()  # fail early on an unknown demo user
        return b

    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(exc.body(), status_code=exc.status)

    @app.exception_handler(ProviderError)
    async def _provider_error(_: Request, exc: ProviderError) -> JSONResponse:
        err = from_provider_error(exc)
        return JSONResponse(err.body(), status_code=err.status)

    @app.exception_handler(RequestValidationError)
    async def _invalid(_: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", []) if p != "body")
        detail = str(first.get("msg", "invalid"))
        message = f"{where}: {detail}" if where else f"Invalid request: {detail}"
        return JSONResponse(ApiError(400, "invalid-request", message).body(), status_code=400)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = "not-found" if exc.status_code == 404 else "http-error"
        return JSONResponse(ApiError(exc.status_code, code, str(exc.detail)).body(),
                            status_code=exc.status_code)

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {"ok": True, "mode": ctx.mode, "configDir": str(settings.config_dir)}

    @app.get("/api/me")
    def me(user: UserHeader = None) -> dict[str, Any]:
        return brain(user).me()

    @app.get("/api/spaces")
    def spaces(user: UserHeader = None) -> list[dict[str, Any]]:
        return brain(user).list_spaces()

    @app.post("/api/spaces", status_code=201)
    def add_space(body: SpaceRequest, user: UserHeader = None) -> dict[str, Any]:
        b = brain(user)
        if body.action == "connect":
            return b.connect_space(body.source or "", body.name)
        return b.create_space(body.name or "", body.kind or "", body.description, body.owners,
                              body.write_policy)

    @app.get("/api/spaces/{space_id}")
    def get_space(space_id: str, user: UserHeader = None) -> dict[str, Any]:
        return brain(user).get_space(space_id)

    @app.delete("/api/spaces/{space_id}")
    def remove_space(space_id: str, user: UserHeader = None) -> dict[str, Any]:
        return brain(user).remove_space(space_id)

    @app.post("/api/spaces/{space_id}/sync")
    def sync(space_id: str, user: UserHeader = None) -> dict[str, Any]:
        return brain(user).sync(space_id)

    @app.post("/api/spaces/{space_id}/save-local")
    def save_local(space_id: str, body: SaveLocalRequest | None = None,
                   user: UserHeader = None) -> dict[str, Any]:
        return brain(user).save_local(space_id, body.message if body else "")

    @app.post("/api/spaces/{space_id}/move")
    def move_file(space_id: str, body: MoveRequest, user: UserHeader = None) -> dict[str, Any]:
        return brain(user).move(space_id, body.from_path, body.to, body.message)

    @app.get("/api/spaces/{space_id}/tree")
    def file_tree(space_id: str, user: UserHeader = None) -> list[dict[str, Any]]:
        return brain(user).tree(space_id)

    @app.get("/api/spaces/{space_id}/file")
    def read_file(space_id: str, path: str, user: UserHeader = None) -> dict[str, Any]:
        return brain(user).read_file(space_id, path)

    @app.put("/api/spaces/{space_id}/file")
    def write(space_id: str, body: WriteRequest, user: UserHeader = None) -> dict[str, Any]:
        return brain(user).write(space_id, body.path, body.content, body.message,
                                 body.base_sha, create=False)

    @app.post("/api/spaces/{space_id}/files", status_code=201)
    def create_file(space_id: str, body: CreateFileRequest,
                    user: UserHeader = None) -> dict[str, Any]:
        return brain(user).write(space_id, body.path, body.content, body.message, None,
                                 create=True)

    @app.delete("/api/spaces/{space_id}/file")
    def delete_file(space_id: str, path: str, message: str = "",
                    user: UserHeader = None) -> dict[str, Any]:
        return brain(user).delete(space_id, path, message)

    @app.get("/api/spaces/{space_id}/history")
    def history(space_id: str, path: str | None = None,
                limit: Annotated[int, Query(ge=1, le=500)] = 50,
                user: UserHeader = None) -> list[dict[str, Any]]:
        return brain(user).history(space_id, path, limit)

    @app.get("/api/spaces/{space_id}/diff")
    def diff(space_id: str, sha: str, path: str | None = None,
             user: UserHeader = None) -> dict[str, Any]:
        return brain(user).diff(space_id, sha, path)

    @app.get("/api/search")
    def search(q: str = "", space: str | None = None,
               limit: Annotated[int, Query(ge=1, le=100)] = 30,
               user: UserHeader = None) -> list[dict[str, Any]]:
        return brain(user).search(q, space, limit)

    @app.get("/api/spaces/{space_id}/members")
    def members(space_id: str, user: UserHeader = None) -> list[dict[str, Any]]:
        return brain(user).members(space_id)

    @app.post("/api/spaces/{space_id}/members", status_code=201)
    def invite(space_id: str, body: InviteRequest,
               user: UserHeader = None) -> list[dict[str, Any]]:
        return brain(user).set_member(space_id, body.login, body.role, invite=True)

    @app.put("/api/spaces/{space_id}/members/{login}")
    def set_role(space_id: str, login: str, body: RoleRequest,
                 user: UserHeader = None) -> list[dict[str, Any]]:
        return brain(user).set_member(space_id, login, body.role, invite=False)

    @app.delete("/api/spaces/{space_id}/members/{login}")
    def remove_member(space_id: str, login: str,
                      user: UserHeader = None) -> list[dict[str, Any]]:
        return brain(user).remove_member(space_id, login)

    @app.get("/api/people")
    def people(user: UserHeader = None) -> dict[str, Any]:
        return brain(user).people()

    @app.get("/api/rules")
    def rules(status: str | None = None, space: str | None = None,
              user: UserHeader = None) -> list[dict[str, Any]]:
        return brain(user).rules(status, space)

    @app.post("/api/rules/{rule_id}/approve")
    def approve(rule_id: str, user: UserHeader = None) -> dict[str, Any]:
        return brain(user).settle_rule(rule_id, approve=True)

    @app.post("/api/rules/{rule_id}/reject")
    def reject(rule_id: str, body: RejectRequest | None = None,
               user: UserHeader = None) -> dict[str, Any]:
        return brain(user).settle_rule(rule_id, approve=False,
                                       reason=body.reason if body else None)

    @app.get("/api/activity")
    def activity(limit: Annotated[int, Query(ge=1, le=200)] = 30,
                 user: UserHeader = None) -> list[dict[str, Any]]:
        return brain(user).activity(limit)

    @app.get("/api/avatars/{login}.svg")
    def avatar(login: str) -> Response:
        return Response(_avatar_svg(login, provider), media_type="image/svg+xml",
                        headers={"Cache-Control": "public, max-age=86400"})

    return app


def _bootstrap(settings: Settings) -> tuple[Context, GitHubProvider]:
    config = settings.config_dir
    if settings.demo:
        if not (config / FIXTURE_FILENAME).exists():
            from selfhub_api.demo import seed

            seed(config)
        store = Store(config)
        personal = Path(str(store.personal().get("path") or config / "personal"))
        provider: GitHubProvider = FixtureGitHubProvider(config / FIXTURE_FILENAME,
                                                         settings.public_url)
        workspace = Workspace(config, personal)
        ctx = Context(workspace=workspace, store=store, locks=SpaceLocks(), mode="demo",
                      commit_as_viewer=True, spaces_dir=config / "spaces")
        return ctx, provider

    store = Store(config)
    personal = settings.personal_path or resolve_repo_path(None, load_settings())
    workspace = Workspace(config, personal)
    org = settings.github_org or load_settings().github_owner or _org_from_spaces(workspace)
    ctx = Context(workspace=workspace, store=store, locks=SpaceLocks(), mode="local")
    return ctx, GhGitHubProvider(org_login=org)


def _org_from_spaces(workspace: Workspace) -> str | None:
    from selfhub_core.history import remote_url

    spaces, _ = workspace.spaces()
    for space in spaces:
        if space.kind != "personal" and space.path.exists():
            repo = parse_github_remote(remote_url(space.path))
            if repo:
                return repo.owner
    return None


_COLORS = ("#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2", "#4f46e5",
           "#b45309", "#0f766e", "#be123c")


def _avatar_svg(login: str, provider: GitHubProvider) -> str:
    name = login
    try:
        name = next((p.name for p in provider.people() if p.login == login), login)
    except ProviderError:
        pass
    words = [w for w in name.replace("-", " ").split() if w]
    initials = "".join(w[0] for w in words[:2]).upper() or "?"
    color = _COLORS[int(hashlib.md5(login.encode(), usedforsecurity=False).hexdigest(), 16)
                    % len(_COLORS)]
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">'
        f'<rect width="96" height="96" rx="48" fill="{color}"/>'
        '<text x="50%" y="50%" dy=".35em" text-anchor="middle" fill="#fff" '
        'font-family="Inter,system-ui,sans-serif" font-size="38" font-weight="600">'
        f"{escape(initials)}</text></svg>"
    )


def main() -> None:
    import uvicorn

    settings = Settings.from_env()
    port = int(os.getenv("SELFHUB_API_PORT", "").strip() or DEFAULT_PORT)
    app = create_app(settings)
    mode = "demo" if settings.demo else "local"
    print(f"SelfHub API ({mode}) on http://localhost:{port}  config: {settings.config_dir}")
    uvicorn.run(app, host=os.getenv("SELFHUB_API_HOST", "127.0.0.1"), port=port)


if __name__ == "__main__":
    main()
