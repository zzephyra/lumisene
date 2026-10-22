"""Script sources, checkpoints and evidence. Frozen DDL generated at authoring time."""

from alembic import op

revision = "0023_script_analysis"
down_revision = "0022_character_graph"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "\nCREATE TABLE script_documents (\n\tproject_id UUID NOT NULL, \n\tfilename VARCHAR(200) NOT NULL, \n\tobject_key VARCHAR(500) NOT NULL, \n\tchecksum VARCHAR(64) NOT NULL, \n\tparse_status VARCHAR(20) NOT NULL, \n\tid UUID NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tupdated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (project_id, id), \n\tUNIQUE (project_id, checksum), \n\tFOREIGN KEY(project_id) REFERENCES projects (id)\n)\n\n"  # noqa: E501
    )
    op.execute("CREATE INDEX ix_script_documents_project_id ON script_documents (project_id)")
    op.execute(
        "\nCREATE TABLE script_segments (\n\tproject_id UUID NOT NULL, \n\tdocument_id UUID NOT NULL, \n\tsequence INTEGER NOT NULL, \n\tstart_offset INTEGER NOT NULL, \n\ttext VARCHAR NOT NULL, \n\tid UUID NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tupdated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(project_id, document_id) REFERENCES script_documents (project_id, id), \n\tUNIQUE (project_id, id), \n\tUNIQUE (document_id, sequence), \n\tFOREIGN KEY(project_id) REFERENCES projects (id)\n)\n\n"  # noqa: E501
    )
    op.execute("CREATE INDEX ix_script_segments_project_id ON script_segments (project_id)")
    op.execute(
        "\nCREATE TABLE character_analysis_jobs (\n\tproject_id UUID NOT NULL, \n\tactor_id UUID NOT NULL, \n\tdocument_id UUID NOT NULL, \n\tidempotency_key VARCHAR(128) NOT NULL, \n\tmodel_config_id UUID NOT NULL, \n\tstatus VARCHAR(20) NOT NULL, \n\tcurrent_stage VARCHAR(30) NOT NULL, \n\tprogress INTEGER NOT NULL, \n\tcheckpoint JSONB NOT NULL, \n\tresult JSONB NOT NULL, \n\terror_message VARCHAR(500), \n\treviewed BOOLEAN NOT NULL, \n\texecution_token UUID, \n\tid UUID NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tupdated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(project_id, document_id) REFERENCES script_documents (project_id, id), \n\tUNIQUE (project_id, actor_id, idempotency_key), \n\tCHECK (status IN ('queued','running','succeeded','failed','canceled')), \n\tFOREIGN KEY(project_id) REFERENCES projects (id), \n\tFOREIGN KEY(actor_id) REFERENCES users (id), \n\tFOREIGN KEY(model_config_id) REFERENCES model_configs (id)\n)\n\n"  # noqa: E501
    )
    op.execute(
        "CREATE INDEX ix_character_analysis_jobs_project_id ON character_analysis_jobs (project_id)"
    )
    op.execute("CREATE INDEX ix_character_analysis_jobs_status ON character_analysis_jobs (status)")
    op.execute(
        "\nCREATE TABLE character_evidence (\n\tproject_id UUID NOT NULL, \n\tsegment_id UUID NOT NULL, \n\tstart_offset INTEGER NOT NULL, \n\tend_offset INTEGER NOT NULL, \n\tquote VARCHAR NOT NULL, \n\tsource_type VARCHAR(20) NOT NULL, \n\tconfidence DOUBLE PRECISION NOT NULL, \n\tid UUID NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tupdated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(project_id, segment_id) REFERENCES script_segments (project_id, id), \n\tFOREIGN KEY(project_id) REFERENCES projects (id)\n)\n\n"  # noqa: E501
    )
    op.execute("CREATE INDEX ix_character_evidence_project_id ON character_evidence (project_id)")


def downgrade():
    op.drop_table("character_evidence")
    op.drop_table("character_analysis_jobs")
    op.drop_table("script_segments")
    op.drop_table("script_documents")
