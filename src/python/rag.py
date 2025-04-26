from fastapi import FastAPI
import uvicorn
from sentence_transformers import SentenceTransformer
import faiss
import numpy as np
import argparse
import os
import json
from pathlib import Path
from typing import List

app = FastAPI()

# 全局变量
model = None
index = None
knowledge_base = []
storage_initialized = False

def initialize_storage(storage_path: str):
    """初始化存储目录和数据结构"""
    global index, knowledge_base, storage_initialized
    
    os.makedirs(storage_path, exist_ok=True)
    
    # 文件路径
    index_file = os.path.join(storage_path, "faiss_index.bin")
    kb_file = os.path.join(storage_path, "knowledge_base.json")
    
    # 加载或创建FAISS索引
    dimension = 384  # all-MiniLM-L6-v2的嵌入维度
    if os.path.exists(index_file):
        index = faiss.read_index(index_file)
        print(f"已从 {index_file} 加载FAISS索引")
    else:
        index = faiss.IndexFlatIP(dimension)
        print(f"创建新的FAISS索引，将保存到 {index_file}")
    
    # 加载或创建知识库
    if os.path.exists(kb_file):
        with open(kb_file, 'r', encoding='utf-8') as f:
            knowledge_base = json.load(f)
        print(f"已从 {kb_file} 加载知识库，共 {len(knowledge_base)} 条记录")
    else:
        knowledge_base = []
        print(f"创建新的知识库，将保存到 {kb_file}")
    
    storage_initialized = True

def save_to_storage(storage_path: str):
    """保存当前状态到存储目录"""
    if not storage_initialized:
        return
    
    index_file = os.path.join(storage_path, "faiss_index.bin")
    kb_file = os.path.join(storage_path, "knowledge_base.json")
    
    faiss.write_index(index, index_file)
    with open(kb_file, 'w', encoding='utf-8') as f:
        json.dump(knowledge_base, f, ensure_ascii=False, indent=2)
    print(f"数据已保存到 {storage_path}")

# 参数解析
def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=7111, help='API 监听端口')
    parser.add_argument('--storage_path', type=str, 
                      default=os.path.join(str(Path.home()), 'CodeReDesignMemory', 'rag_storage'),
                      help='存储路径')
    return parser.parse_args()

args = parse_args()

# 初始化模型和存储
model = SentenceTransformer('all-MiniLM-L6-v2')
initialize_storage(args.storage_path)

@app.post("/add_knowledge")
def add_knowledge(texts: List[str]):
    """
    将文本添加到知识库中。
    - 计算文本的嵌入
    - 将嵌入添加到 FAISS 索引中
    - 将文本存储在 knowledge_base 列表中
    - 自动保存到存储路径
    """
    embeddings = model.encode(texts, convert_to_tensor=True)
    embeddings = embeddings.cpu().numpy()
    
    global index, knowledge_base
    index.add(embeddings)
    knowledge_base.extend(texts)
    
    # 保存到存储
    save_to_storage(args.storage_path)
    
    return {
        "status": "added",
        "count": len(texts),
        "total": len(knowledge_base)
    }

@app.get("/query")
def query(query_text: str):
    """
    根据查询文本检索知识库中最相似的前 5 条文本。
    """
    query_embedding = model.encode([query_text], convert_to_tensor=True)
    query_embedding = query_embedding.cpu().numpy()
    distances, indices = index.search(query_embedding, k=5)
    results = [knowledge_base[i] for i in indices[0]]
    return {
        "query": query_text,
        "results": results,
        "distances": distances[0].tolist()
    }

@app.post("/embed")
def embed(text: str):
    """
    计算单个文本的嵌入。
    """
    embedding = model.encode(text)
    return {
        "text": text,
        "embedding": embedding.tolist(),
        "dimension": len(embedding)
    }

if __name__ == "__main__":
    try:
        uvicorn.run(
            app,
            host="0.0.0.0",
            port=args.port,
            reload=False
        )
    finally:
        # 确保程序退出前保存数据
        save_to_storage(args.storage_path)
        print("服务关闭，数据已保存")