"""Outgoing email through Resend's HTTP API (free tier). Without RESEND_API_KEY, emails are
written to the log instead, so local runs and tests never send anything."""

from __future__ import annotations

import logging

import httpx

from app.config import get_settings

log = logging.getLogger("app.email")


def send_email(to: str, subject: str, html: str, text: str) -> str | None:
    s = get_settings()
    if not s.resend_api_key:
        log.info("EMAIL (not sent, RESEND_API_KEY unset) to=%s subject=%s\n%s", to, subject, text)
        return None
    r = httpx.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {s.resend_api_key}"},
        json={"from": s.email_from, "to": [to], "subject": subject, "html": html, "text": text},
        timeout=30,
    )
    r.raise_for_status()
    return r.json().get("id")
