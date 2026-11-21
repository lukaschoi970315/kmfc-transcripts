#!/usr/bin/env python3
"""
Sync lecture JSON files in data/lectures/*.json into:
1. data/catalog.json (preserving site & series metadata)
2. transcripts/<lecture_id>.md (clean GitHub-browsable Markdown transcripts)

Usage:
    python3 scripts/sync_transcripts.py
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
LECTURES_DIR = DATA_DIR / "lectures"
CATALOG_PATH = DATA_DIR / "catalog.json"
TRANSCRIPTS_DIR = ROOT / "transcripts"


def render_markdown(lecture: dict) -> str:
    lines: list[str] = [f"# {lecture['title']}", ""]
    if lecture.get("instructor"):
        lines.append(f"- **강사**: {lecture['instructor']}")
    if lecture.get("date"):
        lines.append(f"- **게시일**: {lecture['date']}")
    if lecture.get("duration"):
        lines.append(f"- **재생시간**: {lecture['duration']}")
    if lecture.get("sourceUrl"):
        lines.append(f"- **원본 출처**: {lecture['sourceUrl']}")
    embed_url = lecture.get("videoEmbedUrl") or (
        f"https://kakaotv.daum.net/embed/player/cliplink/{lecture['videoId']}"
        if lecture.get("videoId")
        else ""
    )
    if embed_url:
        lines.append(f"- **영상 바로보기**: {embed_url}")
    if lecture.get("tags"):
        lines.append(f"- **태그**: {', '.join(lecture['tags'])}")
    lines.append("")

    if lecture.get("overview"):
        lines.extend(["## 강의 개요", "", lecture["overview"], ""])

    if lecture.get("keyTakeaways"):
        lines.extend(["## 핵심 학습 포인트", ""])
        for item in lecture["keyTakeaways"]:
            lines.append(f"- {item}")
        lines.append("")

    if lecture.get("glossary"):
        lines.extend(["## 핵심 용어 정리", ""])
        for g in lecture["glossary"]:
            sub = f" ({g['hanjaOrEn']})" if g.get("hanjaOrEn") else ""
            ts = f" `[{g['timestamp']}]`" if g.get("timestamp") else ""
            lines.append(f"- **{g['term']}**{sub}{ts}: {g['definition']}")
        lines.append("")

    lines.extend(["## 전체 녹취록", ""])
    for sec in lecture.get("sections", []):
        ts = sec.get("timestamp", "")
        lines.extend([f"### [{ts}] {sec['title']}", ""])
        if sec.get("summary"):
            lines.extend([f"> {sec['summary']}", ""])
        for p in sec.get("paragraphs", []):
            p_time = p.get("time", "")
            prefix = f"**[{p_time}]** " if p_time else ""
            lines.extend([f"{prefix}{p['text']}", ""])

    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
    LECTURES_DIR.mkdir(parents=True, exist_ok=True)

    if CATALOG_PATH.exists():
        catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    else:
        catalog = {
            "site": {
                "title": "근의학 강의 녹취 아카이브",
                "subtitle": "바른몸애 & 한국 근의학 연구소",
                "description": "최신근육학총설 동영상 강의를 주제별·시간별로 정리한 학습용 녹취 아카이브",
            },
            "series": [
                {
                    "id": "kmfc-vol1",
                    "title": "최신근육학총설 1권",
                    "description": "기초 용어해설 및 주요 근육별 해부학·임상 강의 시리즈",
                    "sourceBoardUrl": "https://m.cafe.daum.net/kmfc2/haqk",
                    "order": 1,
                }
            ],
            "lectures": [],
        }

    lecture_entries: list[dict] = []
    for json_file in sorted(LECTURES_DIR.glob("*.json")):
        lecture = json.loads(json_file.read_text(encoding="utf-8"))
        lid = lecture["id"]

        md_path = TRANSCRIPTS_DIR / f"{lid}.md"
        md_path.write_text(render_markdown(lecture), encoding="utf-8")

        lecture_entries.append(
            {
                "id": lid,
                "seriesId": lecture.get("seriesId", "kmfc-vol1"),
                "episode": lecture.get("episode", 1),
                "title": lecture["title"],
                "instructor": lecture.get("instructor", ""),
                "date": lecture.get("date", ""),
                "duration": lecture.get("duration", ""),
                "durationSeconds": lecture.get("durationSeconds", 0),
                "sourceUrl": lecture.get("sourceUrl", ""),
                "videoId": lecture.get("videoId", ""),
                "videoEmbedUrl": lecture.get("videoEmbedUrl", ""),
                "tags": lecture.get("tags", []),
                "summary": lecture.get("overview", ""),
                "glossaryCount": len(lecture.get("glossary", [])),
                "sectionCount": len(lecture.get("sections", [])),
                "file": f"data/lectures/{json_file.name}",
                "markdownFile": f"transcripts/{md_path.name}",
            }
        )

    lecture_entries.sort(key=lambda x: (x.get("seriesId", ""), x.get("episode", 0)))
    catalog["lectures"] = lecture_entries
    CATALOG_PATH.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Synced {len(lecture_entries)} lecture(s) into {CATALOG_PATH} and {TRANSCRIPTS_DIR}/")


if __name__ == "__main__":
    main()
