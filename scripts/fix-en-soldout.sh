#!/bin/bash

# Fix all EN shop pages to include sold out functionality
# Copy the prods.forEach block from ES to EN with English text

for en_file in ~/Proax/mahjoy/en/shop-*.html; do
  filename=$(basename "$en_file")
  es_file=~/Proax/mahjoy/"$filename"
  
  if [ -f "$es_file" ]; then
    echo "Processing: $filename"
    
    # Extract the product rendering script from ES file and adapt for EN
    # The key difference is "Ver producto" -> "View Product" and price formatting
    
    # Check if EN file doesn't have soldOut code
    if ! grep -q "isSoldOut=p.stock===0" "$en_file"; then
      echo "  - Needs update: $en_file"
      
      # Get the prods.forEach block from ES and adapt for EN
      # We'll use sed to replace the block
    fi
  fi
done

echo "Done checking files"
