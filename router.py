import sys, os, json, math
import numpy as np
import pandas as pd

from database import Database

class Router(object):
    """
    Класс роута
    """
    def __init__(self):
        self.db   = []
        self.meta = None

    def set_db_count(self, count):
        """
        задаем количество баз данных
        """
        for i in count:
            _db = Database()
            self.db.append(_db)

        return self

    def set_meta(self,meta):
        """
        Задаем метаанализатор
        """
        self.meta = meta
        self.meta.init_by_db( len(self.db) )

    def print_db_loader(self):
        """
        печатаем нагрузку на базу данных
        """
        for db in self.db:
            db.print_loader()
        return self

    def send_package(self,package):
        """
        отправляем пакет
        """
        # получае мидентификатор базы
        _db_id = self.meta.get_db_id( package )
        # отправляем в нужную базу пакет
        self.db[ _db_id ].send_package( package )
        return self