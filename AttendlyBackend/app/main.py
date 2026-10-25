from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from app.config import settings
from app.routers import health, auth, workers, sites, attendance, dashboard, sync, advances, payroll, analytics

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Backend for Attendly Mobile",
)

@app.exception_handler(IntegrityError)
async def integrity_error_handler(request: Request, exc: IntegrityError):
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"detail": "Database integrity constraint violation. The requested operation conflicts with existing records."},
    )

# Enable CORS for local development and mobile network access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health router
app.include_router(health.router)
app.include_router(health.router, prefix=settings.API_V1_STR)

# Authentication router (supports both /api/v1/auth and /api/auth)
app.include_router(auth.router, prefix=settings.API_V1_STR)
app.include_router(auth.router, prefix="/api")

# Workers router (supports both /api/v1/workers and /api/workers)
app.include_router(workers.router, prefix=settings.API_V1_STR)
app.include_router(workers.router, prefix="/api")

# Site Analytics router (must precede /sites/{site_id} wildcard)
app.include_router(analytics.router, prefix=settings.API_V1_STR)
app.include_router(analytics.router, prefix="/api")

# Sites router (supports both /api/v1/sites and /api/sites)
app.include_router(sites.router, prefix=settings.API_V1_STR)
app.include_router(sites.router, prefix="/api")

# Attendance router (supports both /api/v1/attendance and /api/attendance)
app.include_router(attendance.router, prefix=settings.API_V1_STR)
app.include_router(attendance.router, prefix="/api")

# Dashboard router (supports both /api/v1/dashboard and /api/dashboard)
app.include_router(dashboard.router, prefix=settings.API_V1_STR)
app.include_router(dashboard.router, prefix="/api")

# Advances router (supports both /api/v1/advances and /api/advances)
app.include_router(advances.router, prefix=settings.API_V1_STR)
app.include_router(advances.router, prefix="/api")

# Payroll router (supports both /api/v1/payroll and /api/payroll)
app.include_router(payroll.router, prefix=settings.API_V1_STR)
app.include_router(payroll.router, prefix="/api")

# Sync router (supports both /api/v1/sync and /api/sync)
app.include_router(sync.router, prefix=settings.API_V1_STR)
app.include_router(sync.router, prefix="/api")




@app.get("/")
def root():
    return {
        "message": "Attendly Mobile API is running",
        "version": settings.VERSION,
        "docs": "/docs",
    }
