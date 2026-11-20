#!/usr/bin/env python3
"""
Génère les documents d'entrée FICTIFS de l'exercice 8 (consigne : « à générer vous-même »).

Option A (Commercial ESN) : 2 CV de consultants + 1 brief technique client
Option B (Candidat augmenté) : 1 CV + 1 portfolio/lettre + 1 fiche de poste
Bonus : une version « scannée » (image seule, sans couche texte) du brief A
        pour démontrer le fallback OCR de l'extracteur.

Toutes les personnes et entreprises sont inventées.
Usage : python3 tools/make_samples.py samples/
"""
import os
import subprocess
import sys
import tempfile

from PIL import Image
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (HRFlowable, ListFlowable, ListItem, Paragraph,
                                SimpleDocTemplate, Spacer, Table, TableStyle)

ACCENT = colors.HexColor("#1F4E79")
SS = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=SS["Title"], fontSize=20, textColor=ACCENT, alignment=TA_LEFT, spaceAfter=4)
SUB = ParagraphStyle("SUB", parent=SS["Normal"], fontSize=11, textColor=colors.HexColor("#444444"), spaceAfter=6)
H2 = ParagraphStyle("H2", parent=SS["Heading2"], fontSize=12.5, textColor=ACCENT, spaceBefore=10, spaceAfter=4)
BODY = ParagraphStyle("BODY", parent=SS["Normal"], fontSize=10, leading=14)
SMALL = ParagraphStyle("SMALL", parent=SS["Normal"], fontSize=8.5, textColor=colors.grey)


def bullets(items):
    return ListFlowable([ListItem(Paragraph(i, BODY), leftIndent=10) for i in items],
                        bulletType="bullet", start="•", leftIndent=12)


def section(title, *content):
    out = [Paragraph(title, H2), HRFlowable(width="100%", color=ACCENT, thickness=0.6), Spacer(1, 4)]
    out.extend(content)
    return out


def build(path, story):
    doc = SimpleDocTemplate(path, pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm,
                            topMargin=1.6 * cm, bottomMargin=1.6 * cm,
                            title=os.path.basename(path), author="Données fictives - ESIEA Growth Hacking")
    story = list(story) + [Spacer(1, 14), Paragraph("Document fictif généré pour l'exercice 8 (Growth Hacking, ESIEA).", SMALL)]
    doc.build(story)


def skills_table(rows):
    t = Table(rows, colWidths=[4.2 * cm, 12.3 * cm])
    t.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), "Helvetica", 9.5),
        ("FONT", (0, 0), (0, -1), "Helvetica-Bold", 9.5),
        ("TEXTCOLOR", (0, 0), (0, -1), ACCENT),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return t


# --------------------------------------------------------------------------- Option A
def consultant_1(path):
    build(path, [
        Paragraph("Julien MARCHAND", H1),
        Paragraph("Architecte Cloud &amp; Sécurité — 9 ans d'expérience", SUB),
        Paragraph("julien.marchand@exemple-mail.fr · 06 12 34 56 78 · Rennes (35) · linkedin.com/in/julien-marchand-demo", SMALL),
        *section("Synthèse", Paragraph(
            "Architecte cloud certifié Azure, spécialisé dans la conception d'infrastructures sécurisées "
            "et l'automatisation Infrastructure as Code. A conduit 6 migrations vers Azure pour des "
            "entreprises de plus de 2 000 salariés.", BODY)),
        *section("Compétences", skills_table([
            ["Cloud", "Microsoft Azure (landing zones, Azure Policy, Entra ID), AWS (notions)"],
            ["IaC / DevOps", "Terraform, Ansible, GitLab CI, Azure DevOps"],
            ["Conteneurs", "Kubernetes (AKS), Docker, Helm"],
            ["Sécurité", "IAM et moindre privilège, durcissement CIS, segmentation réseau, Key Vault"],
            ["Certifications", "AZ-305 Azure Solutions Architect Expert, AZ-500 Azure Security Engineer, Terraform Associate"],
            ["Langues", "Français (natif), Anglais (professionnel, C1)"],
        ])),
        *section("Expériences",
                 Paragraph("<b>Architecte Cloud Sécurité</b> — Groupe de distribution (2 400 salariés) · 2022 - aujourd'hui", BODY),
                 bullets([
                     "Conception de la landing zone Azure et de 120 politiques Azure Policy appliquées automatiquement.",
                     "Migration de 85 applications vers Azure en 14 mois, sans interruption de service majeure.",
                     "Réduction de 40 % des comptes à privilèges grâce à la mise en place de Privileged Identity Management.",
                 ]),
                 Spacer(1, 5),
                 Paragraph("<b>Ingénieur Infrastructure &amp; Cloud</b> — Assureur régional · 2018 - 2022", BODY),
                 bullets([
                     "Industrialisation des déploiements avec Terraform : délai de mise à disposition passé de 5 jours à 2 heures.",
                     "Mise en place d'un cluster AKS de production hébergeant 30 microservices.",
                 ]),
                 Spacer(1, 5),
                 Paragraph("<b>Administrateur systèmes</b> — ESN · 2016 - 2018", BODY),
                 bullets(["Administration Linux/Windows pour 3 clients industriels, astreintes N2."])),
        *section("Formation", Paragraph("Diplôme d'ingénieur en informatique et réseaux — 2016", BODY)),
    ])


def consultant_2(path):
    build(path, [
        Paragraph("Sarah BENALI", H1),
        Paragraph("Consultante GRC &amp; Détection (SOC) — 6 ans d'expérience", SUB),
        Paragraph("sarah.benali@exemple-mail.fr · 07 98 76 54 32 · Nantes (44)", SMALL),
        *section("Synthèse", Paragraph(
            "Consultante en gouvernance, risques et conformité, avec une double compétence opérationnelle "
            "en détection d'incidents sur Microsoft Sentinel. Accompagne des opérateurs de services essentiels "
            "dans leur mise en conformité NIS2.", BODY)),
        *section("Compétences", skills_table([
            ["GRC", "ISO 27001 / 27005, EBIOS Risk Manager, directive NIS2, PSSI, plans de traitement des risques"],
            ["Détection", "Microsoft Sentinel, requêtes KQL, Defender for Cloud, playbooks Logic Apps"],
            ["Automatisation", "Python (pandas, scripts d'audit), PowerShell"],
            ["Méthodes", "Animation d'ateliers, conduite du changement, sensibilisation des équipes"],
            ["Certifications", "ISO 27001 Lead Implementer, SC-200 Security Operations Analyst"],
            ["Langues", "Français (natif), Anglais (courant, C1), Arabe (intermédiaire)"],
        ])),
        *section("Expériences",
                 Paragraph("<b>Consultante GRC senior</b> — Cabinet de conseil cybersécurité · 2021 - aujourd'hui", BODY),
                 bullets([
                     "Pilotage de 4 analyses de risques EBIOS RM pour des opérateurs du secteur énergie.",
                     "Accompagnement de 2 entreprises jusqu'à la certification ISO 27001, obtenue sans non-conformité majeure.",
                     "Rédaction de la feuille de route NIS2 d'un groupe de 3 500 salariés (32 mesures priorisées).",
                 ]),
                 Spacer(1, 5),
                 Paragraph("<b>Analyste SOC</b> — Fournisseur de services managés · 2019 - 2021", BODY),
                 bullets([
                     "Création de 45 règles de détection KQL sur Microsoft Sentinel.",
                     "Diminution de 30 % des faux positifs par l'ajustement des règles et l'automatisation du tri.",
                 ])),
        *section("Formation", Paragraph("Master Sécurité des systèmes d'information — 2019", BODY)),
    ])


def brief_client(path):
    build(path, [
        Paragraph("Brief technique — Projet AZUR-NIS2", H1),
        Paragraph("Client : Valmora Énergies (fictif) · Direction des Systèmes d'Information · Consultation ESN", SUB),
        *section("Contexte", Paragraph(
            "Valmora Énergies, producteur d'énergie renouvelable (1 800 salariés), est désormais entité essentielle "
            "au sens de la directive NIS2. La DSI migre son socle applicatif vers Microsoft Azure et doit démontrer "
            "la maîtrise de ses risques cyber d'ici 12 mois.", BODY)),
        *section("Objectifs du projet", bullets([
            "Construire une plateforme Azure sécurisée (landing zone, gestion des identités, segmentation).",
            "Automatiser le déploiement de l'infrastructure en Infrastructure as Code.",
            "Mettre en place la détection des incidents de sécurité sur le périmètre cloud.",
            "Conduire l'analyse de risques et produire la feuille de route de conformité NIS2.",
        ])),
        *section("Compétences attendues", bullets([
            "Architecture Microsoft Azure et sécurité des identités (Entra ID, moindre privilège).",
            "Terraform et chaîne CI/CD.",
            "Kubernetes (AKS) pour 25 microservices à héberger.",
            "Microsoft Sentinel et écriture de règles de détection.",
            "Analyse de risques EBIOS Risk Manager et connaissance de la norme ISO 27001.",
            "Connaissance de la directive NIS2.",
            "Anglais professionnel (échanges avec l'éditeur et l'équipe d'Amsterdam).",
        ])),
        *section("Organisation", bullets([
            "Démarrage souhaité : janvier 2027, pour une durée de 9 mois.",
            "Équipe cible : 2 consultants, présence sur site 2 jours par semaine à Nantes.",
            "Interlocuteur : Directeur technique (CTO) de Valmora Énergies.",
        ])),
    ])


# --------------------------------------------------------------------------- Option B
def cv_candidat(path):
    build(path, [
        Paragraph("Camille ROUSSEL", H1),
        Paragraph("Ingénieure cybersécurité — profil Gouvernance, Risques &amp; Conformité", SUB),
        Paragraph("camille.roussel@exemple-mail.fr · 06 55 44 33 22 · Laval (53) · Permis B", SMALL),
        *section("Profil", Paragraph(
            "Jeune diplômée d'école d'ingénieurs, spécialité cybersécurité. Double compétence technique et "
            "gouvernance : je traduis les risques techniques en décisions compréhensibles par les métiers.", BODY)),
        *section("Compétences", skills_table([
            ["Gouvernance", "ISO 27001 / 27005, EBIOS Risk Manager, NIS2, RGPD, rédaction de PSSI"],
            ["Audit", "Audit organisationnel, revue des habilitations, contrôles CIS Controls"],
            ["Technique", "Python, Bash, PowerShell, Linux, Active Directory, Wireshark"],
            ["Outils", "Excel avancé, Power BI, Jira, Confluence"],
            ["Langues", "Anglais C1 (TOEIC 945), Espagnol B1"],
        ])),
        *section("Expériences",
                 Paragraph("<b>Stage de fin d'études — Consultante GRC</b> · Cabinet de conseil cyber · avril - septembre 2026", BODY),
                 bullets([
                     "Conduite de 12 entretiens métiers pour une analyse de risques EBIOS RM.",
                     "Cartographie de 40 actifs essentiels et de leurs dépendances.",
                     "Script Python de revue des habilitations : délai de revue réduit de 35 %.",
                 ]),
                 Spacer(1, 5),
                 Paragraph("<b>Stage — Assistante RSSI</b> · Collectivité territoriale · juin - août 2025", BODY),
                 bullets([
                     "Préparation d'une campagne de sensibilisation au phishing pour 600 agents.",
                     "Mise à jour de la charte informatique et de 8 procédures de sécurité.",
                 ])),
        *section("Formation",
                 Paragraph("Diplôme d'ingénieur, spécialité cybersécurité — 2026", BODY),
                 Paragraph("Formation EBIOS Risk Manager avec travaux pratiques — 2026", BODY)),
        *section("Engagements", bullets([
            "Présidente d'une association étudiante (organisation d'événements, budget de 15 000 €).",
            "Participation à 6 compétitions CTF en équipe.",
        ])),
    ])


def portfolio(path):
    build(path, [
        Paragraph("Portfolio &amp; lettre de motivation", H1),
        Paragraph("Camille ROUSSEL — candidature au poste de Consultante Cybersécurité GRC junior", SUB),
        *section("Lettre de motivation", Paragraph(
            "Madame, Monsieur, votre offre de consultant GRC junior correspond exactement au métier que je veux exercer : "
            "aider des organisations à comprendre leurs risques et à prioriser leurs actions. Pendant mon stage, j'ai "
            "appris à animer des ateliers avec des métiers non techniques et à transformer une analyse de risques en "
            "plan d'action concret. Je souhaite mettre cette rigueur et ce sens de la pédagogie au service de vos "
            "clients du secteur de l'énergie.", BODY)),
        *section("Réalisation 1 — Analyse de risques EBIOS RM",
                 Paragraph("Contexte : PME industrielle de 300 salariés. Rôle : co-animation des ateliers 1 à 5.", BODY),
                 bullets(["12 entretiens métiers menés.",
                          "5 scénarios stratégiques retenus et présentés au comité de direction.",
                          "Plan de traitement de 18 mesures, dont 6 prioritaires."])),
        *section("Réalisation 2 — Automatisation de la revue des habilitations",
                 Paragraph("Script Python qui compare les exports Active Directory et RH et signale les comptes orphelins.", BODY),
                 bullets(["Délai de revue réduit de 35 %.", "73 comptes orphelins identifiés lors de la première exécution."])),
        *section("Réalisation 3 — Sensibilisation",
                 Paragraph("Conception d'un parcours de sensibilisation au phishing pour 600 agents : taux de clic "
                           "passé de 21 % à 9 % entre la première et la seconde campagne.", BODY)),
        *section("Ce que j'apporte", bullets([
            "La capacité d'expliquer un risque cyber à un public non technique.",
            "Une base technique solide pour dialoguer avec les équipes d'exploitation.",
            "Rigueur rédactionnelle : livrables clairs et actionnables.",
        ])),
    ])


def offre(path):
    build(path, [
        Paragraph("Offre d'emploi — Consultant(e) Cybersécurité GRC junior (H/F)", H1),
        Paragraph("Orvane Conseil (fictif) · CDI · Nantes, télétravail partiel · Démarrage : février 2027", SUB),
        *section("Qui sommes-nous ?", Paragraph(
            "Orvane Conseil accompagne des opérateurs d'énergie et de transport dans la gestion de leurs risques "
            "cyber et leur mise en conformité réglementaire (NIS2, ISO 27001).", BODY)),
        *section("Vos missions", bullets([
            "Conduire des analyses de risques selon la méthode EBIOS Risk Manager.",
            "Accompagner nos clients vers la conformité NIS2 et la certification ISO 27001.",
            "Réaliser des audits organisationnels et des revues des habilitations.",
            "Rédiger des politiques de sécurité et des plans de traitement des risques.",
            "Sensibiliser les collaborateurs de nos clients aux bonnes pratiques.",
        ])),
        *section("Profil recherché", bullets([
            "Diplôme d'ingénieur ou Master en cybersécurité.",
            "Connaissance des normes ISO 27001 / 27005 et de la méthode EBIOS RM.",
            "Aisance relationnelle et capacité à vulgariser auprès de publics non techniques.",
            "Qualités rédactionnelles.",
            "Anglais professionnel.",
            "Un premier usage de Python ou de l'automatisation est un plus.",
        ])),
        *section("Contact", Paragraph("Responsable du recrutement : recrutement@orvane-conseil.example", BODY)),
    ])


def make_scanned(src_pdf, dst_pdf):
    """Rasterise un PDF (150 dpi, léger flou/gris) pour simuler un scan sans couche texte."""
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["pdftoppm", "-r", "150", "-gray", "-png", src_pdf, os.path.join(tmp, "p")], check=True)
        pages = sorted(f for f in os.listdir(tmp) if f.endswith(".png"))
        imgs = [Image.open(os.path.join(tmp, p)).convert("L").rotate(0.6, fillcolor=255, expand=False) for p in pages]
        imgs[0].save(dst_pdf, save_all=True, append_images=imgs[1:], resolution=150)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "samples"
    a, b = os.path.join(out, "option_A"), os.path.join(out, "option_B")
    os.makedirs(a, exist_ok=True)
    os.makedirs(b, exist_ok=True)
    consultant_1(os.path.join(a, "A_CV_consultant_1.pdf"))
    consultant_2(os.path.join(a, "A_CV_consultant_2.pdf"))
    brief_client(os.path.join(a, "A_Brief_client_Valmora.pdf"))
    make_scanned(os.path.join(a, "A_Brief_client_Valmora.pdf"), os.path.join(a, "A_Brief_client_Valmora_SCANNE.pdf"))
    cv_candidat(os.path.join(b, "B_CV_candidat.pdf"))
    portfolio(os.path.join(b, "B_Portfolio_lettre.pdf"))
    offre(os.path.join(b, "B_Offre_Orvane.pdf"))
    print("PDF générés dans", out)


if __name__ == "__main__":
    main()
