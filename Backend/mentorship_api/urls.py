from django.urls import path

from . import views


urlpatterns = [
    path("health/", views.health, name="health"),
    path("mentors/", views.mentors, name="mentors"),
    path("auth/register/", views.register, name="register"),
    path("auth/login/", views.login, name="login"),
    path("users/<str:user_id>/availability/", views.set_availability, name="set_availability"),
    path("requests/", views.requests_endpoint, name="requests"),
    path("requests/<str:request_id>/", views.update_request, name="update_request"),
]
