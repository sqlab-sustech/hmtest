class AppTestException(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.message = message


class NoActionsException(AppTestException):
    def __init__(self, message):
        super().__init__(message)
