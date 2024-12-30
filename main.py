import argparse
import random
import shutil
import time

from app_test import AppTest
from hmdriver2.driver import Driver


def main(serial, app, project_path, module_name, t):
    shutil.rmtree("output")
    product_name = "default"
    start_time = time.time()
    app_test = AppTest(serial, app, project_path, module_name, product_name, t)
    app_test.start_test()
    print(f"Test Finish! Total Time: {time.time() - start_time} seconds.")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="")
    parser.add_argument("--serial", type=str, required=False, help="The serial number of your device(hdc list targets)")
    parser.add_argument("--bundle_name", type=str, required=True, help="The bundle name of the app you want to test")
    parser.add_argument("--project_path", type=str, required=False,
                        help="The open-source project path of the app you want to install")
    parser.add_argument("--module_name", type=str, required=False, help="The module name of the open-source app")
    parser.add_argument("--product_name", type=str, required=False, help="The product name of the open-source app")
    parser.add_argument("--test_time", type=str, required=False, help="The total time you want to test")
    parser.add_argument("--seed", type=str, required=False, help="Random seed")
    args = parser.parse_args()
    if args.seed:
        random.seed(args.seed)
    main(args.serial, args.bundle_name, args.project_path, args.module_name, args.test_time)
