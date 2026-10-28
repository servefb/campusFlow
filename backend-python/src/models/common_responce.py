class result:
    def __init__(self, code: int, message: str, data: dict = None):
        self.code = code
        self.message = message
        self.data = data

    def success(data: dict = None):
        return {
            "code": 0,
            "message": "ok",
            "data": data
        }

    def error(self):
        return {
            "code": self.code,
            "message": self.message,
            "data": self.data
        }


class page:
    def __init__(self, page: int, page_size: int, total: int, has_more: bool, items: list):
        self.items = items
        self.page = page
        self.page_size = page_size
        self.total = total
        self.has_more = has_more
