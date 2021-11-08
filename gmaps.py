from datetime import datetime
import googlemaps


class DistanceMatrix():
    def setUp(self):
        with open("key.txt") as f:
            self.key = f.read()
        self.client = googlemaps.Client(self.key)

    def get_depart_at_time(self, destination, arrive_time):
        origins = ["Radmanovačka ul. 6f, 10000, Zagreb"]
        destinations = [destination]

        matrix = self.client.distance_matrix(
            origins,
            destinations,
            mode="driving",
            arrival_time=arrive_time,
        )

        duration = matrix["rows"][0]["elements"][0]["duration"]

        print(duration["text"])  # human readable time
        return duration["value"]  # time in seconds


if __name__ == "__main__":
    destination = "Unska ul. 3, 10000, Zagreb"
    arrive_time = datetime.fromisoformat("2021-11-09T07:40:00")

    dm = DistanceMatrix()
    dm.setUp()
    print(dm.get_depart_at_time(destination, arrive_time))
