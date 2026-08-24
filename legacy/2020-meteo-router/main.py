import sys, os, json, math
import numpy as np
import pandas as pd
import random

from datetime import datetime, timedelta

from meta     import Meta
from database import Database
from package  import Package
from router   import Router

# создаем роутер
router = Router()
# устанавливаем количество баз данных
router.set_db_count( 3 )

# создаем метаобработчик
meta = Meta()
meta.add_type_st()
meta.add_type_lv()
meta.add_type_dt()

# присваиваем метаобработчик роутеру
router.set_meta( meta )

# начинаем генерацию пакетов и отправляем их в маршрутизатор
package_generate(router=router)

# печатаем нагрузку на БД
router.print_db_loader()

# 
# генератор пакетов
# @period - время, за которое анализируем в днях
def package_generate(router, period=30):
    start_dt = datetime( 2020, 1, 1, 0, 0, 0 )
    delta    = timedelta( minutes = 15 )
    end_dt   = start_dt + timedelta( days = period )
    _dt      = start_dt

    surf_stations = 10000
    aero_stations = 1000

    while _dt < end_dt:
        # аэрология
        if ( _dt.hour % 12 == 0 and _dt.minutes == 0 ):
            for i in range( aero_stations ):
                for lv in [ '1000','925','850','700','500','400','300','200','100','50','20' ]:
                    _p   = Package()
                    _p.set_dt(_dt)
                    _p.set_station(i)
                    _p.set_level(lv)
                    _p.set_type('kn04')
                    _p.sendto(router)
        # приземные станции
        if ( _dt.hour % 3 == 0 and _dt.minutes == 0 ):
            for i in range( surf_stations ):
                _p   = Package()
                _p.set_dt(_dt)
                _p.set_station(i)
                _p.set_level(0)
                _p.set_type('kn01')
                _p.sendto(router)
        for i in randint(3, 100):
            _p   = Package()
            _p.set_dt(_dt)
            _p.set_station(i)
            _p.set_level(0)
            _p.set_type('bufr')
            _p.sendto(router)
        _dt += delta