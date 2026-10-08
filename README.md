# OpenMentor

OpenMentor is a campus mentorship platform where juniors can find seniors, request guidance, and track mentorship sessions.

## Stack

- **Frontend**: React 19 with Vite
- **Backend**: Python with Django 5
- **Database**: MongoDB through PyMongo

---

## Run The Frontend

```bash
cd Frontend/openmentor
npm install
npm run dev
```

The app runs at `http://localhost:5173`.

---

## Run The Backend

```bash
cd Backend
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS / Linux
pip install -r requirements.txt
copy .env.example .env         # then edit .env with your values
python manage.py runserver
```

The API runs at `http://localhost:8000/api`.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health/` | Health check – reports DB connectivity |
| `GET` | `/api/mentors/` | List all available mentors |
| `POST` | `/api/auth/register/` | Register a new junior or senior account |
| `POST` | `/api/auth/login/` | Log in and receive the user object |
| `GET` | `/api/requests/?userId=<id>&role=junior\|senior` | Fetch requests for a user |
| `POST` | `/api/requests/` | Junior creates a mentorship request |
| `PATCH` | `/api/requests/<id>/` | Senior accepts, rejects, or completes a request |
| `PATCH` | `/api/users/<id>/availability/` | Senior toggles their availability |
| `PATCH` | `/api/users/<id>/profile/` | Update user profile (name, bio, skills, mode, availability) |

---

## Data Model

MongoDB stores data in three collections: `users`, `mentors`, and `requests`.

- Senior registration automatically creates a linked `mentors` document.
- Toggling availability updates both `users` and `mentors`.
- Marking a request as `Completed` increments the mentor's `sessions` counter.
- The API never seeds or returns demo data. When MongoDB is unavailable, it returns a `503` service error.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```bash
copy Backend\.env.example Backend\.env
```

| Variable | Description | Default (dev) |
|----------|-------------|---------------|
| `DJANGO_SECRET_KEY` | **Required** – must be 50+ characters | — |
| `DJANGO_DEBUG` | Enable debug mode | `false` |
| `DJANGO_ALLOWED_HOSTS` | Comma-separated list of allowed hosts | `localhost,127.0.0.1` (when DEBUG=true) |
| `CORS_ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins | `http://localhost:5173` (when DEBUG=true) |
| `DJANGO_SECURE_SSL_REDIRECT` | Redirect HTTP → HTTPS | `false` |
| `DJANGO_SECURE_HSTS_SECONDS` | HSTS max-age in seconds | `0` |
| `MONGODB_URI` | Full MongoDB connection string | `mongodb://localhost:27017` |
| `MONGODB_NAME` | MongoDB database name | `openmentor` |
| `MONGODB_TIMEOUT_MS` | Server selection timeout in milliseconds | `1200` |

If MongoDB requires authentication:

```bash
MONGODB_URI=mongodb://username:password@localhost:27017/openmentor?authSource=admin
```

---

## Frontend API Configuration

Create `Frontend/openmentor/.env` only if you need to override the API URL:

```bash
VITE_API_BASE_URL=http://localhost:8000/api
```

For a same-origin production deployment, omit `VITE_API_BASE_URL` — the frontend will use `/api` automatically.

---

## Production Checklist

- Set `DJANGO_SECRET_KEY` to a randomly generated 50+ character string.
- Set `DJANGO_DEBUG=false`.
- Set `DJANGO_ALLOWED_HOSTS` to your domain(s).
- Set `CORS_ALLOWED_ORIGINS` to your frontend origin(s).
- Set `DJANGO_SECURE_SSL_REDIRECT=true` and `DJANGO_SECURE_HSTS_SECONDS=31536000` when the reverse proxy terminates HTTPS.
- Use a TLS-enabled deployment (nginx, Caddy, etc.).
- Session and CSRF cookies are automatically set to `Secure=true` when `DJANGO_DEBUG=false`.
