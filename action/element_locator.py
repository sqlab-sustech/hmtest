from enum import Enum

from hmdriver2.xpath import XMLElement
from hmdriver2.driver import Driver


class ElementLocator(Enum):
    XPATH = "xpath"
    # TEXT = "text"
    # TYPE = "type"

    def locate(self, d: Driver, location: str) -> XMLElement | None:
        if self == ElementLocator.XPATH:
            return d.xpath(location)
        # elif self == ElementLocator.TEXT:
        #     return d(text=location)
        # elif self == ElementLocator.TYPE:
        #     return d(type=location)
        else:
            return None
