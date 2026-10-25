from datetime import datetime
from typing import List, Optional, Any, Dict
from pydantic import BaseModel
from app.schemas.worker import WorkerResponse, WorkerCreate
from app.schemas.site import SiteResponse, SiteCreate
from app.schemas.attendance import AttendanceResponse, AttendanceCreate
from app.schemas.advance import AdvanceResponse, AdvanceCreate


class SyncPushRequest(BaseModel):
    workers: List[WorkerCreate] = []
    sites: List[SiteCreate] = []
    attendance: List[AttendanceCreate] = []
    advances: List[AdvanceCreate] = []


class SyncPushResponse(BaseModel):
    success: bool
    synced_workers: int
    synced_sites: int
    synced_attendance: int
    synced_advances: int
    errors: List[str] = []


class SyncPullResponse(BaseModel):
    server_time: datetime
    workers: List[WorkerResponse] = []
    sites: List[SiteResponse] = []
    attendance: List[AttendanceResponse] = []
    advances: List[AdvanceResponse] = []
