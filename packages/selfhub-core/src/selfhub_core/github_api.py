from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib import error, request


class GitHubApiError(RuntimeError):
    pass


@dataclass(slots=True)
class GitHubRepo:
    clone_url: str
    full_name: str
    private: bool


class GitHubBootstrapClient:
    def __init__(self, token: str, owner: str) -> None:
        self.token = token
        self.owner = owner
        self.base_url = "https://api.github.com"

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
    ) -> tuple[int, dict[str, Any]]:
        url = f"{self.base_url}{path}"
        body: bytes | None = None
        headers = {
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {self.token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "selfhub-cli",
        }

        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"

        req = request.Request(url=url, data=body, headers=headers, method=method)
        try:
            with request.urlopen(req, timeout=20) as response:
                raw = response.read().decode("utf-8")
                data = json.loads(raw) if raw else {}
                return (response.getcode(), data)
        except error.HTTPError as exc:
            body_bytes = exc.read()
            parsed: dict[str, Any] = {}
            if body_bytes:
                try:
                    parsed = json.loads(body_bytes.decode("utf-8"))
                except json.JSONDecodeError:
                    parsed = {}
            message = parsed.get("message", str(exc))
            raise GitHubApiError(f"GitHub API error ({exc.code}): {message}") from exc
        except error.URLError as exc:
            raise GitHubApiError(f"GitHub API network error: {exc.reason}") from exc

    def _current_login(self) -> str:
        _, data = self._request("GET", "/user")
        login = data.get("login")
        if not isinstance(login, str) or not login:
            raise GitHubApiError("Unable to determine GitHub account login")
        return login

    def _parse_repo(self, data: dict[str, Any]) -> GitHubRepo:
        clone_url = data.get("clone_url")
        full_name = data.get("full_name")
        private = data.get("private")

        if not isinstance(clone_url, str) or not clone_url:
            raise GitHubApiError("GitHub response missing clone_url")
        if not isinstance(full_name, str) or not full_name:
            raise GitHubApiError("GitHub response missing full_name")
        if not isinstance(private, bool):
            raise GitHubApiError("GitHub response missing private flag")

        return GitHubRepo(clone_url=clone_url, full_name=full_name, private=private)

    def ensure_private_repo(self, repo_name: str) -> GitHubRepo:
        try:
            _, existing = self._request("GET", f"/repos/{self.owner}/{repo_name}")
            return self._parse_repo(existing)
        except GitHubApiError as exc:
            if "(404)" not in str(exc):
                raise

        user_login = self._current_login()
        payload = {
            "name": repo_name,
            "private": True,
            "auto_init": False,
        }

        if user_login.lower() == self.owner.lower():
            _, created = self._request("POST", "/user/repos", payload=payload)
            return self._parse_repo(created)

        _, created = self._request("POST", f"/orgs/{self.owner}/repos", payload=payload)
        return self._parse_repo(created)
