from fastapi import Request
from sqlalchemy.orm import Session

from app.core.deps import client_ip
from app.models import AuditLog, User


def audit(
    db: Session,
    user: User | None,
    action: str,
    entity: str,
    entity_id: object = None,
    details: dict | None = None,
    request: Request | None = None,
) -> None:
    """UM-17: who, what, when for admin/staff actions. Caller commits."""
    db.add(
        AuditLog(
            user_id=user.id if user else None,
            action=action,
            entity=entity,
            entity_id=str(entity_id) if entity_id is not None else None,
            details=details,
            ip=client_ip(request) if request else None,
        )
    )
