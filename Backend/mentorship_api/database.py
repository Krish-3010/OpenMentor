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
    if _client is None:
        _client = MongoClient(settings.MONGODB_URI, serverSelectionTimeoutMS=1200)

    try:
        _client.admin.command("ping")
    except Exception:
        return None

    return _client[settings.MONGODB_NAME]
