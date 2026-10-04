"""Deployment configuration: no provider secrets or production data in source."""
from dataclasses import dataclass
import os
from urllib.parse import urlsplit

@dataclass(frozen=True)
class Settings:
    origin: str = "http://localhost:8000"
    environment: str = "development"
    database: str = "sqlite:///.data/fillmycourt.sqlite"
    booking_enabled: bool = False
    supabase_url: str = ""
    supabase_publishable_key: str = ""
    google_id: str = ""
    google_secret: str = ""
    apple_id: str = ""
    apple_team: str = ""
    apple_key_id: str = ""
    apple_private_key: str = ""
    legal_name: str = ""
    legal_address: str = ""
    privacy_email: str = ""
    terms_version: str = ""
    legal_published: bool = False
    playtomic_id: str = ""
    playtomic_secret: str = ""
    playtomic_tenants: tuple[str,...] = ()
    data_contract: str = "legacy-v04"

    @classmethod
    def from_env(cls):
        return cls(
            origin=os.getenv("GAC_PUBLIC_ORIGIN","http://localhost:8000").rstrip("/"),
            environment=os.getenv("GAC_ENV","development"),
            database=os.getenv("FMC_DATABASE_URL","sqlite:///.data/fillmycourt.sqlite"),
            booking_enabled=os.getenv("GAC_BOOKING_ENABLED")=="true",
            supabase_url=os.getenv("SUPABASE_URL","").rstrip("/"),
            supabase_publishable_key=os.getenv("SUPABASE_PUBLISHABLE_KEY",""),
            google_id=os.getenv("GOOGLE_CLIENT_ID",""),
            google_secret=os.getenv("GOOGLE_CLIENT_SECRET",""),
            apple_id=os.getenv("APPLE_CLIENT_ID",""),
            apple_team=os.getenv("APPLE_TEAM_ID",""),
            apple_key_id=os.getenv("APPLE_KEY_ID",""),
            apple_private_key=os.getenv("APPLE_PRIVATE_KEY","").replace("\\n","\n"),
            legal_name=os.getenv("OPERATOR_LEGAL_NAME",""),
            legal_address=os.getenv("OPERATOR_LEGAL_ADDRESS",""),
            privacy_email=os.getenv("PRIVACY_EMAIL",""),
            terms_version=os.getenv("TERMS_VERSION",""),
            legal_published=os.getenv("LEGAL_PUBLISHED")=="true",
            playtomic_id=os.getenv("PLAYTOMIC_CLIENT_ID",""),
            playtomic_secret=os.getenv("PLAYTOMIC_CLIENT_SECRET",""),
            playtomic_tenants=tuple(x.strip() for x in os.getenv("PLAYTOMIC_TENANT_IDS","").split(",") if x.strip()),
            data_contract=os.getenv("FMC_DATA_CONTRACT","legacy-v04"),
        )

    @property
    def secure(self):
        return self.origin.startswith("https://")

    @property
    def legal_ready(self):
        return all((self.legal_name,self.legal_address,self.privacy_email,self.terms_version,self.legal_published))

    def enabled(self, provider):
        if self.data_contract == "supabase-v1":
            return bool(self.supabase_url and self.supabase_publishable_key)
        if not self.legal_ready:
            return False
        if provider=="google":
            return bool(self.google_id and self.google_secret)
        if provider=="apple":
            return self.secure and bool(self.apple_id and self.apple_team and self.apple_key_id and self.apple_private_key)
        return False

    def validate(self):
        u=urlsplit(self.origin)
        if u.scheme not in ("http","https") or not u.netloc or u.path or u.query or u.fragment:
            raise RuntimeError("GAC_PUBLIC_ORIGIN must be an origin without a path.")
        if self.environment in ("staging","production"):
            if not self.secure or not self.database.startswith("postgresql"):
                raise RuntimeError("Staging and production require HTTPS and a PostgreSQL database URL.")
            if self.data_contract != "supabase-v1":
                raise RuntimeError("Managed deployments require FMC_DATA_CONTRACT=supabase-v1.")
            if not self.supabase_url.startswith("https://") or not self.supabase_publishable_key:
                raise RuntimeError("Managed deployments require SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.")
