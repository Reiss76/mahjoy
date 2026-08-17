#!/usr/bin/env python3
"""
Translate Mahjoy site from Spanish to English
"""
import os
import re
import glob

EN_DIR = 'en'

# Common translations (Spanish → English)
TRANSLATIONS = {
    # Nav
    'Carrito': 'Cart',
    'Inicio': 'Home',
    'Colección': 'Collection',
    'Social Club': 'Social Club',
    'Acerca': 'About',
    'Contacto': 'Contact',
    'Tienda': 'Shop',
    'Shop ▾': 'Shop ▾',
    
    # Shop categories
    'Bundles ✦': 'Bundles ✦',
    'Tiles': 'Tiles',
    'Mats': 'Mats',
    'Racks': 'Racks',
    'Mahjoy Bags': 'Mahjoy Bags',
    'Tile Bags': 'Tile Bags',
    'Rack Bags': 'Rack Bags',
    'Accessories': 'Accessories',
    'Card Holders': 'Card Holders',
    'Shufflers': 'Shufflers',
    'Line Finder': 'Line Finder',
    
    # Buttons/CTAs
    'Ver producto': 'View Product',
    'Ver productos': 'View Products',
    'Comprar ahora': 'Buy Now',
    'Comprar ahora →': 'Buy Now →',
    'Agregar al carrito': 'Add to Cart',
    'Añadir al carrito': 'Add to Cart',
    'Continuar comprando': 'Continue Shopping',
    'Ir al carrito': 'Go to Cart',
    'Finalizar compra': 'Checkout',
    'Enviar': 'Send',
    'Enviar pedido': 'Submit Order',
    'Enviar mensaje': 'Send Message',
    'Explorar': 'Explore',
    'Explorar colección': 'Explore Collection',
    'Ver más': 'See More',
    'Ver todo': 'See All',
    'Volver': 'Back',
    'Volver a la tienda': 'Back to Shop',
    'Cerrar': 'Close',
    
    # Product/Stock
    'En stock': 'In Stock',
    'Pocas piezas disponibles': 'Few pieces left',
    'Agotado': 'Sold Out',
    'Disponible': 'Available',
    'Sin stock': 'Out of Stock',
    'Cargando…': 'Loading…',
    'Cargando': 'Loading',
    'Sin productos disponibles': 'No products available',
    'Error cargando productos': 'Error loading products',
    
    # Cart
    'Tu carrito está vacío': 'Your cart is empty',
    'Tu carrito': 'Your Cart',
    'Subtotal': 'Subtotal',
    'Total': 'Total',
    'Cantidad': 'Quantity',
    'Eliminar': 'Remove',
    'Producto': 'Product',
    'Precio': 'Price',
    
    # Checkout
    'Datos de envío': 'Shipping Information',
    'Nombre completo': 'Full Name',
    'Teléfono': 'Phone',
    'Correo electrónico': 'Email',
    'Dirección': 'Address',
    'Ciudad': 'City',
    'Estado': 'State',
    'Código postal': 'Zip Code',
    'País': 'Country',
    'Notas del pedido': 'Order Notes',
    'Código de descuento': 'Discount Code',
    'Aplicar': 'Apply',
    
    # Footer
    'Suscríbete': 'Subscribe',
    'Suscribirse': 'Subscribe',
    'Síguenos': 'Follow Us',
    'Contáctanos': 'Contact Us',
    'Think. Play. Mahjong.': 'Think. Play. Mahjong.',
    
    # About
    'Nuestra historia': 'Our Story',
    'Sobre nosotros': 'About Us',
    'El equipo': 'The Team',
    'Conócenos': 'Meet Us',
    
    # Contact
    'Escríbenos': 'Write to Us',
    'Envíanos un mensaje': 'Send us a message',
    '¿Cómo podemos ayudarte?': 'How can we help you?',
    'Tu mensaje': 'Your message',
    'Mensaje': 'Message',
    
    # Social Club
    'Únete al club': 'Join the Club',
    'Torneos': 'Tournaments',
    'Próximos torneos': 'Upcoming Tournaments',
    'Inscribirse': 'Register',
    'Ver detalles': 'View Details',
    'Jugadores': 'Players',
    'Mesas': 'Tables',
    'Fecha': 'Date',
    'Hora': 'Time',
    'Ubicación': 'Location',
    
    # Bundle page
    'Arma tu Set': 'Build Your Set',
    'Selecciona tus piezas': 'Select Your Pieces',
    'Tu selección': 'Your Selection',
    'Resumen': 'Summary',
    'Paso': 'Step',
    
    # Misc
    'Nuevo': 'New',
    'Destacado': 'Featured',
    'Más vendido': 'Best Seller',
    'Oferta': 'Sale',
    'Gratis': 'Free',
    'Envío gratis': 'Free Shipping',
    'Garantía': 'Warranty',
    'Devoluciones': 'Returns',
    'Preguntas frecuentes': 'FAQ',
    
    # Error pages
    'Página no encontrada': 'Page Not Found',
    'Lo sentimos, esta página no existe': 'Sorry, this page does not exist',
    'Volver al inicio': 'Back to Home',
    
    # Meta/SEO
    'MAH JOY es donde el arte del Mahjong se encuentra con la pura alegría': 'MAH JOY is where the art of Mahjong meets pure joy',
    'una comunidad vibrante para jugadores, entusiastas y coleccionistas': 'a vibrant community for players, enthusiasts and collectors',
}

# Longer content translations (page-specific)
CONTENT_TRANSLATIONS = {
    # Homepage
    "Let&#x27;s play together": "Let's play together",
    "Let's play together": "Let's play together",
    "Comunidad de jugadores": "Player Community",
    "Fichas premium": "Premium Tiles",
    "Diseño único": "Unique Design",
    "Hecho con amor": "Made with Love",
    "Nacido en Monterrey. Jugado alrededor del mundo.": "Born in Monterrey. Played around the world.",
    "Born in Monterrey. Played around the world.": "Born in Monterrey. Played around the world.",
    "Alegría en cada juego. Belleza en cada ficha.": "Joy in every game. Beauty in every tile.",
    "Joy in every game. Beauty in every tile.": "Joy in every game. Beauty in every tile.",
    
    # About page
    "LA HISTORIA DE MAHJOY": "THE MAHJOY STORY",
    "THE MAHJOY STORY": "THE MAHJOY STORY",
    "Mónica y Marcela, fundadoras de MAH JOY": "Monica and Marcela, founders of MAH JOY",
    "Dos amigas, una pasión": "Two friends, one passion",
    "Crafted in Mexico.": "Crafted in Mexico.",
    
    # Contact
    "Feel free to write me a message": "Feel free to write us a message",
    "Massive results start here": "Let's connect",
    "What&#x27;s your name?": "What's your name?",
    "What&#x27;s you email address?": "What's your email address?",
    "Your message": "Your message",
    "Message here": "Your message here",
    
    # Form labels
    "Lionel Messi": "John Doe",
    "email@email.com": "email@example.com",
    
    # Checkout messages
    "Al enviar tu pedido, un asesor de MAH JOY te contactará vía WhatsApp para confirmar disponibilidad, coordinar el pago y el envío.": 
        "After submitting your order, a MAH JOY advisor will contact you via WhatsApp to confirm availability and coordinate payment and shipping.",
    
    # Shop headers
    "Sets Disponibles": "Available Sets",
    "PRÓXIMAMENTE": "COMING SOON",
}

def translate_file(filepath):
    """Translate a single HTML file"""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    original = content
    
    # Apply content translations first (longer strings)
    for es, en in CONTENT_TRANSLATIONS.items():
        content = content.replace(es, en)
    
    # Apply word/phrase translations
    for es, en in TRANSLATIONS.items():
        # Be careful with HTML context - translate text content, not attributes
        # Simple replacement for now
        content = content.replace(f'>{es}<', f'>{en}<')
        content = content.replace(f'>{es} ', f'>{en} ')
        content = content.replace(f' {es}<', f' {en}<')
        content = content.replace(f'"{es}"', f'"{en}"')
        content = content.replace(f"'{es}'", f"'{en}'")
        # Also handle standalone in innerHTML/text
        content = content.replace(f">{es}</", f">{en}</")
    
    # Update page titles
    content = re.sub(
        r'<title>([^<]*) — MAH JOY</title>',
        lambda m: f'<title>{m.group(1)} — MAH JOY</title>',
        content
    )
    
    # Update internal links to stay in /en/ 
    # Links like href="about.html" should become href="about.html" (same folder)
    # Links like href="/" should become href="/en/"
    # Links like href="/index.html" should become href="/en/index.html"
    content = content.replace('href="/"', 'href="/en/"')
    content = content.replace("href='/'", "href='/en/'")
    
    # Add lang="en" to html tag
    content = re.sub(r'<html([^>]*)>', r'<html\1 lang="en">', content)
    content = content.replace('lang="en" lang="en"', 'lang="en"')  # Avoid duplicates
    
    # Write back
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    
    return content != original

def add_language_switcher(filepath, is_english=True):
    """Add language switcher to nav"""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Language switcher HTML
    if is_english:
        switcher = '''<a href="/{page}" class="nav-link w-inline-block" style="font-size:0.75rem;opacity:0.8;"><div class="nav-link-text">ES</div></a>'''
    else:
        switcher = '''<a href="/en/{page}" class="nav-link w-inline-block" style="font-size:0.75rem;opacity:0.8;"><div class="nav-link-text">EN</div></a>'''
    
    # Get current page name
    page_name = os.path.basename(filepath)
    switcher = switcher.replace('{page}', page_name)
    
    # Insert before cart link in nav
    if 'mj-lang-switch' not in content:
        # Find cart link and insert before it
        cart_pattern = r'(<a href="[^"]*cart\.html"[^>]*class="[^"]*mj-cart-nav[^"]*")'
        if re.search(cart_pattern, content):
            content = re.sub(
                cart_pattern,
                f'<div class="mj-lang-switch" style="display:flex;align-items:center;margin-right:8px;">{switcher}</div>\\1',
                content
            )
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            return True
    return False

def main():
    # Translate all English files
    en_files = glob.glob(f'{EN_DIR}/*.html')
    print(f"Translating {len(en_files)} files in /{EN_DIR}/...")
    
    translated = 0
    for f in en_files:
        if translate_file(f):
            translated += 1
            print(f"  ✓ {os.path.basename(f)}")
    
    print(f"\nTranslated {translated} files")
    
    # Add language switcher to Spanish files
    es_files = glob.glob('*.html')
    print(f"\nAdding language switcher to {len(es_files)} Spanish files...")
    for f in es_files:
        if f.startswith('en/'):
            continue
        add_language_switcher(f, is_english=False)
    
    # Add language switcher to English files
    print(f"Adding language switcher to {len(en_files)} English files...")
    for f in en_files:
        add_language_switcher(f, is_english=True)
    
    print("\n✅ Done!")

if __name__ == '__main__':
    main()
