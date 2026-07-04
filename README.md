# ani-tracker

## Development

Run the application:

```bash
uv run python -m app.main
```

Run lint checks:

```bash
uv run ruff check app
```

Run type checks:

```bash
uv run mypy app
```

Run tests:

```bash
uv run pytest
```

## Authentication API

The backend uses Flask signed Cookie Session auth. Login and registration set an
HttpOnly session cookie. Local development uses `secure=false`; production should
set `SESSION_COOKIE_SECURE=true` by running with `FLASK_ENV=production` or an
equivalent config override. The default `SameSite` value is `Lax`.

Frontend calls must include credentials:

```ts
fetch("http://localhost:3001/api/auth/me", { credentials: "include" });
```

If the frontend and backend use different origins, configure `CORS_ORIGIN` with a
specific origin such as `http://localhost:3000`. Credentialed requests cannot use
`Access-Control-Allow-Origin: *`.

Future OIDC login can reuse the same application Session Cookie by setting the
same `session["user_id"]` after the OIDC callback resolves an application user.

### Register

`POST /api/auth/register`

Request:

```json
{
  "username": "link",
  "email": "link@link.com",
  "password": "password123",
  "displayName": "Link"
}
```

Success response, `201 Created`:

```json
{
  "user": {
    "id": 1,
    "username": "link",
    "displayName": "Link",
    "email": "link@link.com"
  }
}
```

Registration automatically logs the user in and sets the session cookie.
`username` must be unique. `email` is required but not unique.

### Login

`POST /api/auth/login`

Request:

```json
{
  "username": "link",
  "password": "password123"
}
```

Success response, `200 OK`:

```json
{
  "user": {
    "id": 1,
    "username": "link",
    "displayName": "Link",
    "email": "link@link.com"
  }
}
```

Failure response, `401 Unauthorized`:

```json
{
  "message": "Invalid username or password"
}
```

### Logout

`POST /api/auth/logout`

Request body may be empty.

Success response, `200 OK`:

```json
{
  "success": true
}
```

Logout clears the session cookie state so later requests are anonymous.

### Current User

`GET /api/auth/me`

Anonymous response, `200 OK`:

```json
{
  "user": null
}
```

Logged-in response, `200 OK`:

```json
{
  "user": {
    "id": 1,
    "username": "link",
    "displayName": "Link",
    "email": "link@link.com"
  }
}
```

Authentication responses never include `password_hash`.
