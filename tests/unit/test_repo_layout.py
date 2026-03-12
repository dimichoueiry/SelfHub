from selfhub_core.repo_layout import DEFAULT_MARKDOWN_FILES, REPO_NAME, all_standard_paths


def test_repo_name() -> None:
    assert REPO_NAME == "selfhub"


def test_standard_paths_non_empty() -> None:
    paths = all_standard_paths()
    assert len(paths) > 0
    assert set(paths) == set(DEFAULT_MARKDOWN_FILES.keys())
