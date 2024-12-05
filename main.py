import logging
import time

from app_test import AppTest
from config import LogConfig
from data_collector import DataCollector

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
logger.addHandler(LogConfig.get_file_handler())

serial = "9CN0224718027971"
# app = "com.sina.weibo.stage"
app = "zone.yby.seamusic"
app_test = AppTest(serial, app, True)
app_test.start()
data_collector = DataCollector(app_test)
data_collector.start()

time.sleep(600)

app_test.stop()
data_collector.stop()
data_collector.join()
