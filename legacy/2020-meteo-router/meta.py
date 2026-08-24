import sys, os, json, math
import numpy as np
import pandas as pd

class Meta(object):
    """
    Класс генерации метапакета
    """
    def __init__(self):
        self.db_count = 0
        self.st_range = [0,10000]
        self.lv_range = [0,10]
        self.dt_range = [0,24]
        self.tp_range = [0,5]
        

    def init_by_db(self,db_count):
        """
        инициализируем в соответствии с количеством баз данных
        """
        self.db_count = db_count
        return self

    def get_db_id(self,package):
        """
        Получаем айди базы в которую надо записывать в соотстветствии с пришедшим пакетом
        """
        return 0