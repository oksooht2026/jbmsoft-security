import re
import sys

def replace_emojis(html):
    replacements = {
        '🛡️': '<i data-lucide="shield"></i>',
        '🔑': '<i data-lucide="key"></i>',
        '📁': '<i data-lucide="folder-lock"></i>',
        '🌐': '<i data-lucide="globe"></i>',
        '🖥️': '<i data-lucide="monitor"></i>',
        '✅': '<i data-lucide="check-circle"></i>',
        '📋': '<i data-lucide="file-text"></i>',
        '💻': '<i data-lucide="laptop"></i>',
        '👤': '<i data-lucide="user"></i>',
        '⏳': '<i data-lucide="hourglass"></i>',
        '📧': '<i data-lucide="mail"></i>',
        '🔐': '<i data-lucide="lock"></i>',
        '⏱️': '<i data-lucide="clock"></i>',
        '👥': '<i data-lucide="users"></i>',
        '📄': '<i data-lucide="file"></i>',
        '📂': '<i data-lucide="folder"></i>',
        '✉️': '<i data-lucide="mail"></i>',
        '📡': '<i data-lucide="radio"></i>',
        '🧪': '<i data-lucide="flask-conical"></i>',
        '⊞': '<i data-lucide="layout-dashboard"></i>'
    }
    
    for emoji, icon in replacements.items():
        html = html.replace(emoji, icon)
        
    return html

with open('d:\\JBMSOFT_Security\\src\\main-window\\index.html', 'r', encoding='utf-8') as f:
    content = f.read()

content = replace_emojis(content)
content = content.replace('</head>', '  <script src="https://unpkg.com/lucide@latest"></script>\n</head>')
content = content.replace('</body>', '  <script>lucide.createIcons();</script>\n</body>')

with open('d:\\JBMSOFT_Security\\src\\main-window\\index.html', 'w', encoding='utf-8') as f:
    f.write(content)
