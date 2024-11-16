class WebtestException(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.message = message


class NoActionsException(WebtestException):
    def __init__(self, message):
        super().__init__(message)
