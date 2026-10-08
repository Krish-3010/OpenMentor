# OpenMentor

OpenMentor is a campus mentorship platform where juniors can find seniors, request guidance, and track mentorship sessions.

## Stack

- Frontend: React with Vite
- Backend: Python with Django
- Database: MongoDB through PyMongo

## Run The Frontend

```bash
cd Frontend/openmentor
npm install
npm run dev
```

The app runs at `http://localhost:5173`.

## Run The Backend

```bash
cd Backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
python manage.py runserver
```

The API runs at `http://localhost:8000/api`.

Useful endpoints:

- `GET /api/health/`
- `GET /api/mentors/`
- `POST /api/auth/register/`
- `POST /api/auth/login/`
- `GET /api/mentors/` (available mentors only)
- `GET /api/requests/?userId=<id>&role=junior|senior`
- `POST /api/requests/` (junior requests)
- `PATCH /api/requests/<id>/` (senior accepts/rejects)
- `PATCH /api/users/<id>/availability/` (senior availability)

MongoDB stores data in exactly three application collections: `users`, `mentors`, and `requests`. Senior registration creates a mentor profile, and toggling availability updates both the user and mentor records. The API does not seed or return demo data: when MongoDB is unavailable, it returns an explicit service error.

If your MongoDB server requires login, set `MONGODB_URI` in `Backend/.env` with credentials:

```bash
MONGODB_URI=mongodb://username:password@localhost:27017/openmentor?authSource=admin
```

When MongoDB rejects the connection because of missing or wrong credentials, the API returns a service-unavailable response. Configure the connection before deploying.

## Frontend API Configuration

For local development, create `Frontend/openmentor/.env` when the backend URL changes:

```bash
VITE_API_BASE_URL=http://localhost:8000/api
```

For a same-origin production deployment, omit `VITE_API_BASE_URL` so the frontend uses `/api`.

Production must provide a 50+ character `DJANGO_SECRET_KEY`, explicit
`DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, and a TLS-enabled deployment.
Set `DJANGO_SECURE_SSL_REDIRECT=true` and `DJANGO_SECURE_HSTS_SECONDS=31536000`
when the reverse proxy terminates HTTPS. The included `.env.example` uses
development-safe values for local setup.
