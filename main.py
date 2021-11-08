from Google import Create_Service

credentials = "credentials.json"
scopes = ["https://www.googleapis.com/auth/calendar"]
service = Create_Service(credentials, "buffer time", "v3", scopes)
