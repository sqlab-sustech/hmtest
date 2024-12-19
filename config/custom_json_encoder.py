import json


class CustomJSONEncoder(json.JSONEncoder):
    def encode(self, o):
        result = super().encode(o)
        result = result.replace("True", "true").replace("False", "false")
        return result
