"""client accounts: logins to the client area, per-property visibility and message

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-23 10:00:00
"""
from alembic import op
import sqlalchemy as sa

revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('cliente_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_users_cliente_id'), 'users', ['cliente_id'], unique=False)
    op.create_foreign_key('users_cliente_id_fkey', 'users', 'clienti', ['cliente_id'], ['id'], ondelete='CASCADE')
    op.add_column('lotto_cliente', sa.Column('nel_portale', sa.Boolean(), server_default='true', nullable=False))
    op.add_column('lotto_cliente', sa.Column('nota_cliente', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('lotto_cliente', 'nota_cliente')
    op.drop_column('lotto_cliente', 'nel_portale')
    op.drop_constraint('users_cliente_id_fkey', 'users', type_='foreignkey')
    op.drop_index(op.f('ix_users_cliente_id'), table_name='users')
    op.drop_column('users', 'cliente_id')
