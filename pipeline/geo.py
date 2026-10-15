"""Georeferencing helpers for the EPNU campus reconstruction.

Local coordinate system (used everywhere in the project):
  origin  : LAT0, LON0 (approx. centre of the campus fence, WGS84)
  +X      : East  (metres)
  +Y      : North (metres)
  +Z      : Up    (metres)  [Blender convention; glTF export converts to Y-up]
"""
import math

LAT0 = 31.0198510   # centre of traced fence bbox (analysis/source_analysis.md)
LON0 = 32.6275438

def m_per_deg(lat):
    p = math.radians(lat)
    mlat = 111132.92 - 559.82 * math.cos(2 * p) + 1.175 * math.cos(4 * p)
    mlon = 111412.84 * math.cos(p) - 93.5 * math.cos(3 * p)
    return mlat, mlon

MLAT, MLON = m_per_deg(LAT0)

def ll2xy(lat, lon):
    return ((lon - LON0) * MLON, (lat - LAT0) * MLAT)

def xy2ll(x, y):
    return (LAT0 + y / MLAT, LON0 + x / MLON)

# --- Esri z18 mosaic (analysis/satellite/esri_z18.jpg) pixel <-> lat/lon ---
Z18_X0, Z18_Y0, Z = 154825, 107285, 18

def z18px2ll(px, py):
    n = 2 ** Z
    X = Z18_X0 + px / 256.0
    Y = Z18_Y0 + py / 256.0
    lon = X / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * Y / n))))
    return lat, lon

def ll2z18px(lat, lon):
    n = 2 ** Z
    X = (lon + 180.0) / 360.0 * n
    Y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return (X - Z18_X0) * 256.0, (Y - Z18_Y0) * 256.0

def z18px2xy(px, py):
    return ll2xy(*z18px2ll(px, py))

def xy2z18px(x, y):
    return ll2z18px(*xy2ll(x, y))
