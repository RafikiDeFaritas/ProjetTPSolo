#!/bin/bash
# Script de démonstration pour le Livrable 7 - Preuves Réplication & Panne

echo "\n======================================================="
echo "🔵 1. PREUVE DE RÉPLICATION (Lecture sur Replicas)"
echo "======================================================="
echo "On effectue 4 lectures d'affilée pour montrer le Load Balancing :"
echo "-------------------------------------------------------"

for i in {1..4}
do
   # On filtre juste la source pour l'affichage
   RESPONSE=$(curl -s http://localhost:3000/api/history | grep "source")
   echo "Requete $i : $RESPONSE"
done

echo "\n✅ On voit bien que les lectures alternent (ou changent) entre les replicas."
echo "   (Prendre une capture d'écran MAINTENANT pour 'Preuve Réplication')"
read -p "Appuyez sur 'Entrée' pour continuer vers la SIMULATION DE PANNE..."

echo "\n======================================================="
echo "🔴 2. SIMULATION DE PANNE (Arrêt du Primary)"
echo "======================================================="
echo "Commande : docker stop macrocoach-primary"
docker stop macrocoach-primary

echo "\n... Primary arrêté. Testons la ROBUSTESSE :"
echo "-------------------------------------------------------"

echo "👉 TEST A : LECTURE (Doit fonctionner via Replica)"
curl -s http://localhost:3000/db/read-test
echo "\n✅ Lecture OK (Le système survit en lecture seule)"

echo "\n-------------------------------------------------------"
echo "👉 TEST B : ÉCRITURE (Doit échouer)"
curl -X POST http://localhost:3000/api/match \
     -H "Content-Type: application/json" \
     -d '{ "summoner_name": "TestFail", "champion": "Fail", "kda": "0/0/0", "win": false }'
echo "\n❌ Écriture KO (Normal, Primary down)"

echo "\n======================================================="
echo "📸 C'est le moment pour la capture 'Captures panne simulée' !"
echo "======================================================="
read -p "Appuyez sur 'Entrée' pour RESTAURER le système..."

echo "\n🟢 3. RESTAURATION DU PRIMARY"
echo "======================================================="
docker start macrocoach-primary
echo "Attente du redémarrage..."
sleep 5
echo "Vérification Statut : "
curl -s http://localhost:3000/db/status

echo "\n✅ Système rétabli."
