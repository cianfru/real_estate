"""seed the Veneto tribunali used by the firm

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

# codUfficio and nomeUfficio exactly as returned by GET ve-ms/tribunali (see docs/pvp-api.md).
VENETO = [
    ("0280600097", "Tribunale di PADOVA", "Padova", True),
    ("0241160092", "Tribunale di VICENZA", "Vicenza", True),
    ("0260860099", "Tribunale di TREVISO", "Treviso", True),
    ("0270420098", "Tribunale di VENEZIA", "Venezia", True),
    ("0290410098", "Tribunale di ROVIGO", "Rovigo", True),
    ("0240120092", "Tribunale di VICENZA ex Tribunale di BASSANO DEL GRAPPA", "Bassano del Grappa (ex)", False),
]


def upgrade() -> None:
    conn = op.get_bind()
    for code, name, short, active in VENETO:
        conn.execute(
            sa.text(
                "INSERT INTO tribunali (pvp_code, name, short_name, region, active_for_enrichment) "
                "VALUES (:c, :n, :s, 'Veneto', :a) "
                "ON CONFLICT (pvp_code) DO UPDATE SET active_for_enrichment = EXCLUDED.active_for_enrichment"
            ),
            {"c": code, "n": name, "s": short, "a": active},
        )


def downgrade() -> None:
    op.execute("UPDATE tribunali SET active_for_enrichment = false")
