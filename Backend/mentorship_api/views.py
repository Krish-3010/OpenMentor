import json
from datetime import datetime, timezone
from uuid import uuid4

from django.contrib.auth.hashers import check_password, make_password
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods
from bson import ObjectId
from bson.errors import InvalidId
from pymongo.errors import PyMongoError

from .database import get_database


def json_body(request):
    try:
        return json.loads(request.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None


def public_user(user):
    result = {key: value for key, value in user.items() if key not in {"password", "_id"}}
    result["id"] = public_id(user)
    if str(result.get("role", "")).lower() in {"senior", "senior mentor"}:
        result["role"] = "senior"
        result["available"] = result.get("available", True)
    else:
        result["role"] = "junior"
    return result


def public_id(document):
    return str(document.get("id") or document.get("_id"))


def normalize_document(document):
    document = dict(document)
    document["id"] = public_id(document)
    document.pop("_id", None)
    return document


def user_selector(user_id):
    selectors = [{"id": user_id}]
    try:
        selectors.append({"_id": ObjectId(user_id)})
    except (InvalidId, TypeError):
        pass
    return {"$or": selectors}


def _object_id_or_value(value):
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        return value


def senior_role_selector():
    return {"$or": [{"role": "senior"}, {"role": "Senior"}, {"role": "Senior mentor"}]}


def document_selector(document_id):
    return {"$or": [{"id": document_id}, {"_id": _object_id_or_value(document_id)}]}


@require_GET
def health(request):
    database = get_database()
    return JsonResponse(
        {"status": "ok" if database is not None else "degraded", "database": "connected" if database is not None else "unavailable"},
        status=200 if database is not None else 503,
    )


@require_GET
def mentors(request):
    database = get_database()
    if database is None:
        return JsonResponse({"error": "Database unavailable."}, status=503)

    try:
        collection = database.mentors
        mentor_docs = [normalize_document(mentor) for mentor in collection.find({"available": True})]
        return JsonResponse({"mentors": mentor_docs})
    except PyMongoError:
        return JsonResponse({"error": "Could not load mentors."}, status=503)


@csrf_exempt
@require_http_methods(["POST"])
def register(request):
    payload = json_body(request)
    required = ["name", "email", "password", "role"]
    if payload is None:
        return JsonResponse({"error": "Invalid JSON body."}, status=400)
    missing = [field for field in required if not str(payload.get(field, "")).strip()]
    role = str(payload.get("role", "")).lower()
    if missing or role not in {"junior", "senior"} or len(str(payload.get("password", ""))) < 8:
        return JsonResponse({"error": "Name, email, password, and a valid role are required."}, status=400)

    database = get_database()
    if database is None:
        return JsonResponse({"error": "Database unavailable."}, status=503)

    user_name = str(payload["name"]).strip()
    user_email = str(payload["email"]).strip().lower()

    skills_input = payload.get("skills", [])
    if isinstance(skills_input, str):
        skills_list = [s.strip() for s in skills_input.split(",") if s.strip()]
    elif isinstance(skills_input, list):
        skills_list = [str(s).strip() for s in skills_input if str(s).strip()]
    else:
        skills_list = []

    user = {
        "id": str(uuid4()),
        "name": user_name,
        "email": user_email,
        "role": role,
        "available": role == "senior",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "password": make_password(payload["password"]),
        "bio": str(payload.get("bio", "")).strip() or (f"Senior mentor specializing in {', '.join(skills_list)}" if skills_list else "Senior mentor ready to guide students."),
        "skills": skills_list,
        "mode": str(payload.get("mode", "Online")).strip() or "Online",
        "availability": str(payload.get("availability", "Available for mentorship")).strip() or "Available for mentorship",
    }

    try:
        if database.users.find_one({"email": user["email"]}):
            return JsonResponse({"error": "An account with this email already exists."}, status=409)
        database.users.insert_one(user)
        if role == "senior":
            database.mentors.insert_one({
                "id": f"mentor-{user['id']}",
                "userId": user["id"],
                "name": user["name"],
                "role": "Senior mentor",
                "skills": user["skills"],
                "availability": user["availability"],
                "rating": payload.get("rating", 5.0),
                "sessions": 0,
                "mode": user["mode"],
                "bio": user["bio"],
                "available": True,
            })
    except PyMongoError:
        return JsonResponse({"error": "Could not save the account."}, status=503)
    return JsonResponse({"user": public_user(user)}, status=201)


@csrf_exempt
@require_http_methods(["POST"])
def login(request):
    payload = json_body(request)
    if payload is None or not payload.get("email") or not payload.get("password"):
        return JsonResponse({"error": "Email and password are required."}, status=400)
    database = get_database()
    if database is None:
        return JsonResponse({"error": "Database unavailable."}, status=503)
    try:
        user = database.users.find_one({"email": str(payload["email"]).strip().lower()})
    except PyMongoError:
        return JsonResponse({"error": "Could not read accounts."}, status=503)
    if not user or not check_password(payload["password"], user.get("password", "")):
        return JsonResponse({"error": "Invalid email or password."}, status=401)
    return JsonResponse({"user": public_user(normalize_document(user))})


@csrf_exempt
@require_http_methods(["PATCH"])
def set_availability(request, user_id):
    payload = json_body(request)
    if payload is None or not isinstance(payload.get("available"), bool):
        return JsonResponse({"error": "available must be a boolean."}, status=400)
    database = get_database()
    if database is None:
        return JsonResponse({"error": "Database unavailable."}, status=503)
    try:
        user = database.users.find_one({"$and": [user_selector(user_id), senior_role_selector()]})
        if not user:
            return JsonResponse({"error": "Senior account not found."}, status=404)
        user_result = database.users.update_one({"_id": user["_id"]}, {"$set": {"available": payload["available"]}})
        canonical_user_id = public_id(user)
        mentor_selector = {"$or": [{"userId": canonical_user_id}, {"userId": user["_id"]}]}
        mentor_result = database.mentors.update_one(
            mentor_selector,
            {"$set": {"available": payload["available"]}},
        )
        if mentor_result.matched_count == 0:
            database.mentors.insert_one({
                "id": f"mentor-{canonical_user_id}",
                "userId": canonical_user_id,
                "name": user.get("name", "Senior mentor"),
                "role": "Senior mentor",
                "skills": user.get("skills", []),
                "availability": user.get("availability", "Available for mentorship"),
                "rating": 5.0,
                "sessions": 0,
                "mode": user.get("mode", "Online"),
                "bio": user.get("bio", "Senior mentor ready to guide students."),
                "available": payload["available"],
            })
        if user_result.matched_count == 0:
            return JsonResponse({"error": "Senior account not found."}, status=404)
        return JsonResponse({"available": payload["available"], "userId": canonical_user_id})
    except PyMongoError:
        return JsonResponse({"error": "Could not update availability."}, status=503)


@csrf_exempt
@require_http_methods(["PATCH"])
def update_profile(request, user_id):
    payload = json_body(request)
    if payload is None:
        return JsonResponse({"error": "Invalid JSON body."}, status=400)
    database = get_database()
    if database is None:
        return JsonResponse({"error": "Database unavailable."}, status=503)

    try:
        user = database.users.find_one(user_selector(user_id))
        if not user:
            return JsonResponse({"error": "User account not found."}, status=404)

        user_updates = {}
        mentor_updates = {}

        if "name" in payload and str(payload["name"]).strip():
            new_name = str(payload["name"]).strip()
            user_updates["name"] = new_name
            mentor_updates["name"] = new_name

        if "bio" in payload:
            new_bio = str(payload["bio"]).strip()
            user_updates["bio"] = new_bio
            mentor_updates["bio"] = new_bio

        if "skills" in payload:
            raw_skills = payload["skills"]
            if isinstance(raw_skills, list):
                skills_list = [str(s).strip() for s in raw_skills if str(s).strip()]
            elif isinstance(raw_skills, str):
                skills_list = [s.strip() for s in raw_skills.split(",") if s.strip()]
            else:
                skills_list = []
            user_updates["skills"] = skills_list
            mentor_updates["skills"] = skills_list

        if "mode" in payload and str(payload["mode"]).strip():
            new_mode = str(payload["mode"]).strip()
            user_updates["mode"] = new_mode
            mentor_updates["mode"] = new_mode

        if "availability" in payload and str(payload["availability"]).strip():
            new_avail = str(payload["availability"]).strip()
            user_updates["availability"] = new_avail
            mentor_updates["availability"] = new_avail

        if user_updates:
            database.users.update_one({"_id": user["_id"]}, {"$set": user_updates})

        canonical_user_id = public_id(user)
        if str(user.get("role", "")).lower() in {"senior", "senior mentor"} and mentor_updates:
            mentor_selector = {"$or": [{"userId": canonical_user_id}, {"userId": user["_id"]}]}
            database.mentors.update_one(mentor_selector, {"$set": mentor_updates})

        updated_user = database.users.find_one({"_id": user["_id"]})
        return JsonResponse({"user": public_user(normalize_document(updated_user))})
    except PyMongoError:
        return JsonResponse({"error": "Could not update profile."}, status=503)


@require_GET
def list_requests(request):
    database = get_database()
    if database is None:
        return JsonResponse({"error": "Database unavailable."}, status=503)
    user_id = request.GET.get("userId")
    role = request.GET.get("role")
    if not user_id or not role:
        return JsonResponse({"error": "userId and a valid role are required."}, status=400)
    try:
        if role == "junior":
            query = {"juniorId": user_id}
        elif role == "senior":
            mentor = database.mentors.find_one(
                {"$or": [{"userId": user_id}, {"userId": _object_id_or_value(user_id)}]},
                {"id": 1, "_id": 1},
            )
            if not mentor:
                return JsonResponse({"requests": []})
            query = {"mentorId": public_id(mentor)}
        else:
            return JsonResponse({"error": "A valid role is required."}, status=400)
        documents = [normalize_document(item) for item in database.requests.find(query).sort("createdAt", -1)]
        return JsonResponse({"requests": documents})
    except PyMongoError:
        return JsonResponse({"error": "Could not load requests."}, status=503)


@csrf_exempt
@require_http_methods(["POST"])
def create_request(request):
    payload = json_body(request)
    required = ["juniorId", "juniorName", "email", "goal", "preferredTime", "mentorId", "mentorName"]
    if payload is None:
        return JsonResponse({"error": "Invalid JSON body."}, status=400)
    missing = [field for field in required if not str(payload.get(field, "")).strip()]
    if missing:
        return JsonResponse({"error": "Missing required fields.", "fields": missing}, status=400)

    database = get_database()
    if database is None:
        return JsonResponse({"error": "Database unavailable."}, status=503)
    try:
        junior = database.users.find_one(
            {"$and": [user_selector(payload["juniorId"]), {"role": {"$in": ["junior", "Junior"]}}]}
        )
        if not junior:
            return JsonResponse({"error": "Only junior users can create requests."}, status=403)
        mentor = database.mentors.find_one(
            {"$and": [document_selector(payload["mentorId"]), {"available": True}]}
        )
        if not mentor:
            return JsonResponse({"error": "This mentor is not currently available."}, status=409)

        request_doc = {
            "id": str(uuid4()),
            "juniorId": str(payload["juniorId"]).strip(),
            "juniorName": junior.get("name", str(payload["juniorName"]).strip()),
            "email": junior.get("email", str(payload["email"]).strip().lower()),
            "goal": str(payload["goal"]).strip(),
            "preferredTime": str(payload["preferredTime"]).strip(),
            "mentorId": public_id(mentor),
            "mentorName": mentor.get("name", str(payload["mentorName"]).strip()),
            "status": "Requested",
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }

        database.requests.insert_one(request_doc)
        return JsonResponse({"request": normalize_document(request_doc)}, status=201)
    except PyMongoError:
        return JsonResponse({"error": "Could not save the request."}, status=503)


@csrf_exempt
@require_http_methods(["GET", "POST"])
def requests_endpoint(request):
    if request.method == "GET":
        return list_requests(request)
    return create_request(request)


@csrf_exempt
@require_http_methods(["PATCH"])
def update_request(request, request_id):
    payload = json_body(request)
    status = payload.get("status") if payload else None
    senior_id = payload.get("seniorId") if payload else None
    if status not in {"Accepted", "Rejected", "Completed"} or not senior_id:
        return JsonResponse({"error": "A valid status and seniorId are required."}, status=400)
    database = get_database()
    if database is None:
        return JsonResponse({"error": "Database unavailable."}, status=503)
    try:
        request_doc = database.requests.find_one({"id": request_id})
        if not request_doc:
            return JsonResponse({"error": "Request not found."}, status=404)

        mentor = database.mentors.find_one(document_selector(request_doc.get("mentorId")))
        mentor_user_id = mentor.get("userId") if mentor else None
        mentor_matches_senior = mentor_user_id in {senior_id, _object_id_or_value(senior_id)}
        if not mentor or not mentor_matches_senior:
            return JsonResponse({"error": "You can only update requests sent to you."}, status=403)

        previous_status = request_doc.get("status")
        result = database.requests.update_one({"id": request_id}, {"$set": {"status": status}})
        if result.matched_count == 0:
            return JsonResponse({"error": "Request not found."}, status=404)

        if status == "Completed" and previous_status != "Completed":
            database.mentors.update_one({"_id": mentor["_id"]}, {"$inc": {"sessions": 1}})

        return JsonResponse({"status": status})
    except PyMongoError:
        return JsonResponse({"error": "Could not update the request."}, status=503)
