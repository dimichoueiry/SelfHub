"""Seed the Northline demo: real local git repos with backdated history by real-looking
people, a fake GitHub org with roles, and dashboard state.

Nothing touches GitHub. Each shared space gets a bare repo under `remotes/` as its
`origin`, so sync works for real and the spaces start in different sync states:

- Northline     synced
- Ads Team      2 commits behind (Jordan pushed from another clone)
- Apex Roofing  local changes (an uncommitted edit)
- Bolt HVAC     never pushed
- Sam's space   no remote

Run: `uv run python scripts/seed_demo.py [config dir]`.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from selfhub_core.rules import Rule, render_rules
from selfhub_core.spaces import (
    RULES_LEARNED,
    RULES_PROPOSED,
    Registry,
    SpaceManifest,
    codeowners_text,
    save_registry,
)

from selfhub_api import demo_content as c

ORG_LOGIN = "northline-demo"
DEMO_USER = "sam-okafor"


@dataclass(frozen=True, slots=True)
class Who:
    login: str
    name: str
    title: str

    @property
    def email(self) -> str:
        return f"{self.login.split('-')[0]}@northline.agency"


MAYA = Who("maya-chen", "Maya Chen", "Founder & Managing Director")
SAM = Who("sam-okafor", "Sam Okafor", "Paid Social Specialist")
JORDAN = Who("jordan-reyes", "Jordan Reyes", "Head of Strategy")
PRIYA = Who("priya-nair", "Priya Nair", "Account Manager")
LEO = Who("leo-park", "Leo Park", "Junior Ads Coordinator (new hire)")
KEN = Who("ken-ito", "Ken Ito", "Paid Search Specialist")
DANA = Who("dana-whitfield", "Dana Whitfield", "Senior Designer")
MARCUS = Who("marcus-bell", "Marcus Bell", "Operations Lead")
TESS = Who("tess-alvarez", "Tess Alvarez", "Freelance Copywriter")
PEOPLE = (MAYA, SAM, JORDAN, PRIYA, LEO, KEN, DANA, MARCUS, TESS)


class Seeder:
    def __init__(self, root: Path, now: datetime) -> None:
        self.root = root
        self.now = now
        self.gitconfig = root / ".demo-gitconfig"
        self.gitconfig.write_text(
            "[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n", encoding="utf-8"
        )

    def when(self, days: float) -> datetime:
        return self.now - timedelta(days=days)

    def stamp(self, who: Who, days: float) -> str:
        return f"{who.name} ({self.when(days).date().isoformat()})"

    def rule_id(self, days: float, seed: str) -> str:
        digest = hashlib.sha1(seed.encode(), usedforsecurity=False).hexdigest()[:4]
        return f"R-{self.when(days):%Y%m%d}-{digest}"

    def git(self, repo: Path, *args: str, who: Who | None = None, days: float = 0) -> str:
        env = {**os.environ, "GIT_CONFIG_GLOBAL": str(self.gitconfig), "GIT_CONFIG_NOSYSTEM": "1"}
        if who:
            date = self.when(days).isoformat()
            env.update(GIT_AUTHOR_NAME=who.name, GIT_AUTHOR_EMAIL=who.email,
                       GIT_COMMITTER_NAME=who.name, GIT_COMMITTER_EMAIL=who.email,
                       GIT_AUTHOR_DATE=date, GIT_COMMITTER_DATE=date)
        done = subprocess.run(["git", *args], cwd=repo, env=env, check=True,
                              capture_output=True, text=True)
        return done.stdout.strip()

    def init(self, repo: Path, remote: str | None) -> None:
        repo.mkdir(parents=True, exist_ok=True)
        self.git(repo, "init", "-q", "-b", "main")
        # The demo user's identity; the API switches it per request to whoever is acting.
        self.git(repo, "config", "user.name", SAM.name)
        self.git(repo, "config", "user.email", SAM.email)
        self.git(repo, "config", "commit.gpgsign", "false")
        if remote:
            bare = self.root / "remotes" / f"{remote}.git"
            bare.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(bare)], check=True)
            self.git(repo, "remote", "add", "origin", str(bare))

    def commit(self, repo: Path, who: Who, days: float, message: str,
               files: dict[str, str], append: bool = False) -> None:
        for rel, text in files.items():
            target = repo / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            if append and target.exists():
                text = target.read_text(encoding="utf-8").rstrip("\n") + "\n" + text
            target.write_text(text, encoding="utf-8")
        self.git(repo, "add", "--", *files)
        self.git(repo, "commit", "-q", "-m", message, who=who, days=days)


def _manifest_files(manifest: SpaceManifest) -> dict[str, str]:
    files = {".selfhub/space.json": json.dumps(manifest.to_dict(), indent=2) + "\n"}
    if manifest.owners:
        files[".github/CODEOWNERS"] = codeowners_text(manifest)
    return files


def _rules(header: str, rules: list[Rule]) -> str:
    return render_rules(header.splitlines(), rules)


def _learned_header(name: str) -> str:
    return (f"# Learned rules — {name}\n\n"
            "Rules the agents learned from feedback, approved by a human.")


def _proposed_header(name: str) -> str:
    return (f"# Proposed rules — {name}\n\n"
            "Waiting for a human to approve or reject.")


def seed(config_dir: Path, now: datetime | None = None) -> Path:
    """Build the demo under `config_dir` (created if needed). Returns `config_dir`."""
    config_dir.mkdir(parents=True, exist_ok=True)
    if any(p.name != ".DS_Store" for p in config_dir.iterdir()):
        raise RuntimeError(f"{config_dir} is not empty; seed into a fresh directory.")
    s = Seeder(config_dir, (now or datetime.now(tz=UTC)).replace(microsecond=0))
    spaces = config_dir / "spaces"

    northline = _seed_northline(s, spaces / "northline")
    ads = _seed_ads(s, spaces / "ads-team")
    apex = _seed_apex(s, spaces / "apex-roofing")
    bolt = _seed_bolt(s, spaces / "bolt-hvac")
    personal = _seed_personal(s, config_dir / "personal")

    save_registry(config_dir, Registry(spaces=[
        {"name": "Northline", "path": str(northline)},
        {"name": "Ads Team", "path": str(ads)},
        {"name": "Apex Roofing", "path": str(apex)},
        {"name": "Bolt HVAC", "path": str(bolt)},
    ], policies=["cite-sources", "learn-from-feedback"]))
    _write_fixture(config_dir)
    _write_store(s, config_dir, personal)
    return config_dir


def _seed_northline(s: Seeder, repo: Path) -> Path:
    s.init(repo, "brain")
    manifest = SpaceManifest(
        name="Northline", kind="org", aliases=["northline", "org"], locked=["locked/"],
        owners=[f"@{ORG_LOGIN}/admins"], write_policy="pull-request", learn_policy="propose",
        policies=["cite-sources"],
    )
    learned_header = _learned_header("Northline")
    s.commit(repo, MAYA, 120, "Create org space Northline", {
        **_manifest_files(manifest),
        "README.md": c.NORTHLINE_README,
        RULES_LEARNED: learned_header + "\n",
        RULES_PROPOSED: _proposed_header("Northline") + "\n",
    })
    s.commit(repo, MAYA, 118, "Add advertising compliance rules",
             {"locked/compliance.md": c.COMPLIANCE})
    s.commit(repo, MAYA, 117, "Add Northline brand voice",
             {"locked/brand-voice.md": c.BRAND_VOICE})
    s.commit(repo, PRIYA, 90, "Add client onboarding SOP",
             {"sops/client-onboarding.md": c.ONBOARDING_SOP})
    s.commit(repo, JORDAN, 60, "Add creative review checklist",
             {"sops/creative-review.md": c.CREATIVE_REVIEW_SOP})
    s.commit(repo, PRIYA, 30, "Add monthly reporting SOP", {"sops/reporting.md": c.REPORTING_SOP})
    rules = [
        Rule(id=s.rule_id(22, "nl-stack"), title="Never stack two discounts",
             rule="Never combine two discounts or offers in one ad, for any client.",
             why="A Bolt ad stacked the tune-up price with a Club discount; Bolt honored both.",
             source="Bolt HVAC:past-ads/2026-08-ac-tuneup.md",
             proposed_by=s.stamp(KEN, 23), approved_by=s.stamp(MAYA, 21)),
        Rule(id=s.rule_id(16, "nl-cite"), title="Name the review platform",
             rule="When quoting a review count or rating, name the platform (\"4.8★ on Google\").",
             why="Strategist: unsourced ratings read as made up.",
             source="sops/creative-review.md",
             proposed_by=s.stamp(JORDAN, 16), approved_by=s.stamp(MAYA, 15)),
    ]
    s.commit(repo, MAYA, 21, f"[SelfHub] approve {rules[0].id} in Northline",
             {RULES_LEARNED: _rules(learned_header, rules[:1])})
    s.commit(repo, MAYA, 15, f"[SelfHub] approve {rules[1].id} in Northline",
             {RULES_LEARNED: _rules(learned_header, rules)})
    s.commit(repo, MAYA, 9, "Add 'How we work' handbook for new hires",
             {"handbook/how-we-work.md": c.HANDBOOK})
    s.commit(repo, JORDAN, 2, "Creative review: add accessibility checks",
             {"sops/creative-review.md": c.CREATIVE_REVIEW_A11Y}, append=True)
    s.git(repo, "push", "-q", "-u", "origin", "main")
    return repo


def _seed_ads(s: Seeder, repo: Path) -> Path:
    s.init(repo, "ads-team")
    manifest = SpaceManifest(
        name="Ads Team", kind="team", aliases=["ads", "ads-team"],
        owners=["@jordan-reyes"], write_policy="direct", learn_policy="propose",
    )
    learned_header = _learned_header("Ads Team")
    s.commit(repo, JORDAN, 100, "Create team space Ads Team", {
        **_manifest_files(manifest),
        "README.md": c.ADS_README,
        RULES_LEARNED: learned_header + "\n",
        RULES_PROPOSED: _proposed_header("Ads Team") + "\n",
    })
    s.commit(repo, SAM, 98, "Add Facebook & Instagram ads SOP",
             {"sops/facebook-ads.md": c.FACEBOOK_SOP})
    s.commit(repo, KEN, 80, "Add Google Ads SOP", {"sops/google-ads.md": c.GOOGLE_SOP})
    s.commit(repo, SAM, 70, "Add ad brief and variant sheet templates", {
        "templates/ad-brief.md": c.AD_BRIEF_TEMPLATE,
        "templates/facebook-variants.md": c.VARIANTS_TEMPLATE,
    })
    s.commit(repo, SAM, 40, "Add campaign naming convention",
             {"templates/campaign-naming.csv": c.NAMING_CSV})
    approved = [
        Rule(id=s.rule_id(26, "ads-3var"), title="Always deliver three variants",
             rule="Always deliver exactly 3 variants: proof-led, problem-led, offer-led.",
             why="Reviews were slower when variants came in different counts and angles.",
             source="sops/facebook-ads.md", proposed_by=s.stamp(SAM, 27),
             approved_by=s.stamp(JORDAN, 25)),
        Rule(id=s.rule_id(18, "ads-enddate"), title="Every offer shows its end date",
             rule="Every ad that mentions an offer states its end date in the primary text.",
             why="Apex fall ad ran 4 days past the offer; client had to honor it.",
             source="Apex Roofing:past-ads/2026-09-fall-inspection.md",
             proposed_by=s.stamp(KEN, 19), approved_by=s.stamp(JORDAN, 18)),
    ]
    s.commit(repo, JORDAN, 25, f"[SelfHub] approve {approved[0].id} in Ads Team",
             {RULES_LEARNED: _rules(learned_header, approved[:1])})
    s.commit(repo, JORDAN, 18, f"[SelfHub] approve {approved[1].id} in Ads Team",
             {RULES_LEARNED: _rules(learned_header, approved)})
    pending = Rule(
        id=s.rule_id(3, "ads-calltrack"), title="Tracked number on every call asset",
        rule="Every search campaign uses the client's tracked call number in its call asset.",
        why="Bolt calls from Google showed up as 'direct' in August; we couldn't report them.",
        source="sops/google-ads.md", proposed_by=s.stamp(KEN, 3),
    )
    s.commit(repo, KEN, 3, f"[SelfHub] learn {pending.id} in Ads Team",
             {RULES_PROPOSED: _rules(_proposed_header("Ads Team"), [pending])})
    s.git(repo, "push", "-q", "-u", "origin", "main")

    # Jordan pushes two commits from their own clone; Sam's clone hasn't pulled them.
    other = s.root / ".tmp-jordan-clone"
    subprocess.run(["git", "clone", "-q", str(s.root / "remotes" / "ads-team.git"), str(other)],
                   check=True)
    s.commit(other, JORDAN, 1.2, "Facebook SOP: add creative testing cadence",
             {"sops/facebook-ads.md": c.FACEBOOK_TESTING}, append=True)
    s.commit(other, JORDAN, 0.4, "Google SOP: add shared negative keyword list",
             {"sops/google-ads.md": c.GOOGLE_NEGATIVES}, append=True)
    s.git(other, "push", "-q", "origin", "main")
    shutil.rmtree(other)
    s.git(repo, "fetch", "-q", "origin")
    return repo


def _seed_apex(s: Seeder, repo: Path) -> Path:
    s.init(repo, "client-apex")
    manifest = SpaceManifest(
        name="Apex Roofing", kind="client", aliases=["apex"], always_load=["brief.md"],
        owners=["@jordan-reyes", "@priya-nair"], write_policy="direct", learn_policy="propose",
    )
    learned_header = _learned_header("Apex Roofing")
    s.commit(repo, PRIYA, 95, "Create client space Apex Roofing", {
        **_manifest_files(manifest),
        "README.md": "# Apex Roofing\n\nClient space. Loaded only when a task names Apex.\n",
        "brief.md": c.APEX_BRIEF,
        "work/README.md": c.APEX_WORK_README,
        RULES_LEARNED: learned_header + "\n",
        RULES_PROPOSED: _proposed_header("Apex Roofing") + "\n",
    })
    s.commit(repo, PRIYA, 94, "Add current offers", {"offers.md": c.APEX_OFFERS})
    s.commit(repo, SAM, 60, "Add spring hail campaign results",
             {"past-ads/2026-04-spring-hail.md": c.APEX_PAST_SPRING})
    approved = [
        Rule(id=s.rule_id(51, "apex-price"), title="Never quote a replacement price",
             rule="Never state a price for a full roof replacement; every roof is quoted on site.",
             why="Rick: a $9,999 headline brought in leads who left when quoted $16k.",
             source="brief.md", proposed_by=s.stamp(SAM, 52), approved_by=s.stamp(JORDAN, 50)),
        Rule(id=s.rule_id(50, "apex-photo"), title="Use Apex's own job photos",
             rule="Use only Apex's own job photos; never stock roofs.",
             why="Spring test: the real hail photo beat stock by 40% on CPL.",
             source="past-ads/2026-04-spring-hail.md", proposed_by=s.stamp(SAM, 51),
             approved_by=s.stamp(JORDAN, 50)),
        Rule(id=s.rule_id(10, "apex-cta"), title="Soft CTAs only",
             rule="Use soft CTAs (\"Book a free inspection\"), never \"Call now\".",
             why="Dana: 3 summer leads said the ad felt like a sales call.",
             source="past-ads/2026-07-summer-financing.md", proposed_by=s.stamp(PRIYA, 11),
             approved_by=s.stamp(JORDAN, 10)),
    ]
    s.commit(repo, JORDAN, 50, "[SelfHub] approve 2 rules in Apex Roofing",
             {RULES_LEARNED: _rules(learned_header, approved[:2])})
    s.commit(repo, SAM, 35, "Add summer financing campaign results",
             {"past-ads/2026-07-summer-financing.md": c.APEX_PAST_SUMMER})
    s.commit(repo, PRIYA, 14, "Offers: add fall $500 off replacement through Nov 30",
             {"offers.md": c.APEX_OFFERS_FALL}, append=True)
    s.commit(repo, SAM, 12, "Add fall inspection campaign, weeks 1–2",
             {"past-ads/2026-09-fall-inspection.md": c.APEX_PAST_FALL})
    s.commit(repo, JORDAN, 10, f"[SelfHub] approve {approved[2].id} in Apex Roofing",
             {RULES_LEARNED: _rules(learned_header, approved)})
    pending = Rule(
        id=s.rule_id(1, "apex-urgency"), title="No urgency phrasing for Apex",
        rule="Never use urgency phrasing (\"act now\", \"limited time\", \"before it's too late\") "
             "in Apex ads.",
        why="Jordan on the spring promo review: variant 2 was too pushy; Apex hates urgency.",
        source="work/2026-10-11-spring-promo.md", proposed_by=s.stamp(SAM, 1),
    )
    s.commit(repo, SAM, 1, f"[SelfHub] learn {pending.id} in Apex Roofing",
             {RULES_PROPOSED: _rules(_proposed_header("Apex Roofing"), [pending])})
    s.git(repo, "push", "-q", "-u", "origin", "main")
    # Sam's uncommitted draft: the "local changes" sync state.
    draft = repo / "past-ads/2026-09-fall-inspection.md"
    draft.write_text(draft.read_text(encoding="utf-8") + c.APEX_PAST_FALL_LOCAL, encoding="utf-8")
    return repo


def _seed_bolt(s: Seeder, repo: Path) -> Path:
    s.init(repo, "client-bolt")
    manifest = SpaceManifest(
        name="Bolt HVAC", kind="client", aliases=["bolt"], always_load=["brief.md"],
        owners=["@priya-nair"], write_policy="direct", learn_policy="propose",
    )
    learned_header = _learned_header("Bolt HVAC")
    s.commit(repo, PRIYA, 40, "Create client space Bolt HVAC", {
        **_manifest_files(manifest),
        "README.md": "# Bolt HVAC\n\nClient space. Loaded only when a task names Bolt.\n",
        "brief.md": c.BOLT_BRIEF,
        RULES_LEARNED: learned_header + "\n",
        RULES_PROPOSED: _proposed_header("Bolt HVAC") + "\n",
    })
    s.commit(repo, PRIYA, 38, "Add offers", {"offers.md": c.BOLT_OFFERS})
    s.commit(repo, KEN, 20, "Add August AC tune-up results",
             {"past-ads/2026-08-ac-tuneup.md": c.BOLT_PAST})
    rule = Rule(id=s.rule_id(15, "bolt-tacla"), title="TACLA number in every ad",
                rule="Put TACLA license #TACLA00123456E in every ad's primary text or image.",
                why="Texas requires it; an August ad ran without it.",
                source="past-ads/2026-08-ac-tuneup.md", proposed_by=s.stamp(KEN, 16),
                approved_by=s.stamp(PRIYA, 15))
    s.commit(repo, PRIYA, 15, f"[SelfHub] approve {rule.id} in Bolt HVAC",
             {RULES_LEARNED: _rules(learned_header, [rule])})
    s.commit(repo, PRIYA, 4, "Brief: add contacts", {"brief.md": c.BOLT_BRIEF_UPDATE},
             append=True)
    return repo  # never pushed


def _seed_personal(s: Seeder, repo: Path) -> Path:
    s.init(repo, None)
    s.commit(repo, SAM, 150, "Start my SelfHub", {"README.md": c.SAM_README,
                                                 "preferences.md": c.SAM_PREFS})
    s.commit(repo, SAM, 60, "Add my ads workflow", {"sops/ads.md": c.SAM_ADS_SOP})
    s.commit(repo, SAM, 3, "Apex ideas for October", {"notes/2026-10-apex-ideas.md": c.SAM_NOTES})
    return repo


def _write_fixture(config_dir: Path) -> None:
    fixture = {
        "org": {"login": ORG_LOGIN, "name": "Northline"},
        "me": DEMO_USER,
        "people": [{"login": p.login, "name": p.name, "title": p.title, "email": p.email}
                   for p in PEOPLE],
        "teams": [
            {"slug": "admins", "name": "Admins", "members": [MAYA.login, MARCUS.login]},
            {"slug": "ads", "name": "Ads", "members": [SAM.login, KEN.login]},
            {"slug": "strategy", "name": "Strategy", "members": [JORDAN.login]},
            {"slug": "accounts", "name": "Accounts", "members": [PRIYA.login]},
            {"slug": "creative", "name": "Creative", "members": [DANA.login]},
        ],
        "repos": {
            f"{ORG_LOGIN}/brain": {
                "teams": {"admins": "admin", "strategy": "write", "ads": "read",
                          "accounts": "read", "creative": "read"},
                "direct": {LEO.login: "read"},
            },
            f"{ORG_LOGIN}/ads-team": {
                "teams": {"admins": "admin", "ads": "write", "strategy": "write"},
                "direct": {LEO.login: "read"},
            },
            f"{ORG_LOGIN}/client-apex": {
                "teams": {"admins": "admin", "strategy": "admin", "ads": "write",
                          "accounts": "write", "creative": "write"},
                "direct": {TESS.login: "read"},
            },
            f"{ORG_LOGIN}/client-bolt": {
                "teams": {"admins": "admin", "strategy": "admin", "accounts": "write",
                          "creative": "write"},
                "direct": {KEN.login: "write", PRIYA.login: "admin"},
            },
        },
        "pulls": {},
    }
    (config_dir / "github_fixture.json").write_text(json.dumps(fixture, indent=2) + "\n",
                                                    encoding="utf-8")


def _write_store(s: Seeder, config_dir: Path, personal: Path) -> None:
    def iso(days: float) -> str:
        return s.when(days).isoformat()

    def repo(name: str) -> dict[str, str]:
        return {"owner": ORG_LOGIN, "name": name}

    def event(i: int, type_: str, actor: Who, space: str | None, summary: str,
              days: float) -> dict[str, object]:
        return {"id": f"evt_seed{i:02d}", "type": type_, "actor": actor.login, "spaceId": space,
                "summary": summary, "date": iso(days)}

    store = {
        "personal": {"owner": SAM.login, "name": "Sam's space", "path": str(personal),
                     "description": "Sam's own workflows, preferences and notes."},
        "spaces": {
            "northline": {"description": "Company-wide SOPs, brand voice and compliance. "
                          "Every change goes through review.", "repo": repo("brain"),
                          "lastSyncAt": iso(0.1)},
            "ads-team": {"description": "Paid social and paid search SOPs, templates and "
                         "naming conventions.", "repo": repo("ads-team"),
                         "lastSyncAt": iso(3)},
            "apex-roofing": {"description": "Denver roofing client: brief, offers, past "
                             "campaigns and client rules.", "repo": repo("client-apex"),
                             "lastSyncAt": iso(0.25)},
            "bolt-hvac": {"description": "Austin HVAC client: brief, offers and past "
                          "campaigns.", "repo": repo("client-bolt")},
        },
        "events": [
            event(1, "space", PRIYA, "bolt-hvac", "Priya Nair created the client space Bolt HVAC",
                  40),
            event(2, "access", PRIYA, "bolt-hvac", "Priya Nair gave Ken Ito Can edit access to "
                  "Bolt HVAC", 20),
            event(3, "access", MAYA, "apex-roofing", "Maya Chen gave Tess Alvarez Can view "
                  "access to Apex Roofing", 13),
            event(4, "access", MAYA, "northline", "Maya Chen gave Leo Park Can view access to "
                  "Northline", 9),
            event(5, "access", MAYA, "ads-team", "Maya Chen gave Leo Park Can view access to "
                  "Ads Team", 9),
            event(6, "sync", SAM, "ads-team", "Sam Okafor synced Ads Team and got 1 change from "
                  "Ken Ito", 3),
            event(7, "sync", SAM, "apex-roofing", "Sam Okafor synced Apex Roofing and sent 1 "
                  "change", 0.25),
        ],
    }
    (config_dir / "dashboard.json").write_text(json.dumps(store, indent=2) + "\n",
                                               encoding="utf-8")


def main() -> None:
    target = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else Path(
        tempfile.mkdtemp(prefix="selfhub-demo-"))
    seed(target)
    print(f"Seeded the Northline demo in {target}")
    print(f"Start the API with:\n  SELFHUB_DEMO=1 SELFHUB_CONFIG_DIR={target} uv run selfhub-api")


if __name__ == "__main__":
    main()
