import os
from django.conf import settings

try:
    from pymongo import MongoClient
except ImportError:
    MongoClient = None


_client = None


def get_database():
    if MongoClient is None:
        return None

    global _client
    timeout_ms = int(os.environ.get("MONGODB_TIMEOUT_MS", "1200"))
    if _client is None:
        _client = MongoClient(settings.MONGODB_URI, serverSelectionTimeoutMS=timeout_ms)

    try:
        _client.admin.command("ping")
    except Exception:
        _client = None
        return None

    return _client[settings.MONGODB_NAME]

