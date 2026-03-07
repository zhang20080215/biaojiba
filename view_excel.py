#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
查看Excel文件的工具脚本
使用方法: python view_excel.py <excel文件路径>
"""

import sys
import os
import pandas as pd

# 设置输出编码为UTF-8，确保中文正常显示
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def view_excel(file_path):
    """查看Excel文件内容"""
    print(f"正在读取文件: {file_path}")
    
    if not os.path.exists(file_path):
        print(f"错误: 文件不存在 - {file_path}")
        return
    
    try:
        # 读取Excel文件的所有工作表
        excel_file = pd.ExcelFile(file_path)
        sheet_names = excel_file.sheet_names
        
        print(f"\n文件: {file_path}")
        print(f"工作表数量: {len(sheet_names)}")
        print(f"工作表名称: {', '.join(sheet_names)}\n")
        print("=" * 80)
        
        # 显示每个工作表的内容
        for sheet_name in sheet_names:
            print(f"\n【工作表: {sheet_name}】")
            print("-" * 80)
            
            df = pd.read_excel(file_path, sheet_name=sheet_name)
            
            # 显示基本信息
            print(f"行数: {len(df)}, 列数: {len(df.columns)}")
            print(f"列名: {', '.join(df.columns.tolist())}")
            print("\n前10行数据:")
            print(df.head(10).to_string())
            
            # 如果有更多行，提示用户
            if len(df) > 10:
                print(f"\n... (共 {len(df)} 行，仅显示前10行)")
            
            print("\n" + "=" * 80)
        
    except ImportError:
        print("错误: 需要安装 pandas 和 openpyxl 库")
        print("请运行: pip install pandas openpyxl")
    except Exception as e:
        print(f"错误: {str(e)}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("使用方法: python view_excel.py <excel文件路径>")
        print("示例: python view_excel.py data.xlsx")
        sys.exit(1)
    
    file_path = sys.argv[1]
    view_excel(file_path)

