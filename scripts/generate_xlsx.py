import sys
import subprocess

try:
    import pandas as pd
except Exception:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--user', 'pandas', 'openpyxl'])
    import pandas as pd

csv_path = 'development_inventory.csv'
xlsx_path = 'development_inventory.xlsx'

df = pd.read_csv(csv_path)
df.to_excel(xlsx_path, index=False)
print('Wrote', xlsx_path)
